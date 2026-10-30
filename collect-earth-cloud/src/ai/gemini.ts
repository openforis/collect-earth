/**
 * The AI client on Gemini, through Vertex AI, with Google's Gen AI SDK (`@google/genai`).
 *
 * - Vertex AI mode (`enterprise: true`), logging in with the API key when there is one
 *   (AI_VERTEX_API_KEY, sent by the SDK in the `x-goog-api-key` header), otherwise as the
 *   server's service account (Application Default Credentials) with AI_VERTEX_PROJECT and
 *   AI_VERTEX_REGION.
 * - Only our function declarations: no Google Search, code execution or URL context.
 * - One HTTP call per `generate`: no retries (the SDK retries only when `retryOptions` is
 *   set), no automatic continuation, no automatic function calling (that needs SDK
 *   "callable tools", which we never pass). A 60 s timeout per call.
 * - The request and response mappings are pure functions, tested without the network.
 */
import {
  FinishReason,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GoogleGenAIOptions,
  type Part,
} from '@google/genai';
import type { Config } from '../config.js';
import { DEFAULT_AI_MODEL, DEFAULT_AI_REGION } from '../config.js';
import { AiError, type AiCall, type AiClient, type AiRequest, type AiResponse, type AiTurn } from './client.js';

export const AI_TEMPERATURE = 0.2;
export const AI_TIMEOUT_MS = 60_000;

/** The parts of the SDK's GenerateContentResponse that we read. */
export type GeminiResponseShape = Pick<GenerateContentResponse, 'candidates' | 'promptFeedback' | 'usageMetadata'>;

/** What GeminiClient needs from the SDK: `ai.models`. */
export interface GeminiModels {
  generateContent(params: GenerateContentParameters): Promise<GeminiResponseShape>;
}

/** The SDK client options for this server's configuration. The key wins over the project. */
export function geminiClientOptions(config: Config): GoogleGenAIOptions {
  const httpOptions = { timeout: AI_TIMEOUT_MS };
  if (config.aiVertexApiKey) {
    return { enterprise: true, apiKey: config.aiVertexApiKey, httpOptions };
  }
  if (config.aiVertexProject) {
    return {
      enterprise: true,
      project: config.aiVertexProject,
      location: config.aiVertexRegion ?? DEFAULT_AI_REGION,
      httpOptions,
    };
  }
  throw new AiError('The AI assistant is not set up: no Vertex AI key and no project.');
}

/** A Gemini client for this server, or undefined when the AI assistant is not set up. */
export function createGeminiClient(config: Config): AiClient | undefined {
  if (!config.aiConfigured) return undefined;
  const ai = new GoogleGenAI(geminiClientOptions(config));
  return new GeminiClient(ai.models, config.aiModel ?? DEFAULT_AI_MODEL, config.aiVertexApiKey);
}

export class GeminiClient implements AiClient {
  constructor(
    private readonly models: GeminiModels,
    private readonly model: string,
    /** Only to take it out of error messages. */
    private readonly apiKey?: string,
  ) {}

  async generate(req: AiRequest): Promise<AiResponse> {
    let res: GeminiResponseShape;
    try {
      res = await this.models.generateContent(toGeminiRequest(this.model, req));
    } catch (e) {
      throw this.toAiError(e, req.timeoutMs ?? AI_TIMEOUT_MS);
    }
    return fromGeminiResponse(res);
  }

  /** A new error with the status and a short message, without the key and without the SDK's error object. */
  private toAiError(e: unknown, timeoutMs: number): AiError {
    const err = e as { name?: unknown; message?: unknown; status?: unknown } | null;
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return new AiError(`The AI model did not answer within ${Math.round(timeoutMs / 1000)} s.`, { timeout: true });
    }
    let message = typeof err?.message === 'string' ? err.message : 'The call to the AI model failed.';
    if (this.apiKey) message = message.split(this.apiKey).join('[key]');
    if (message.length > 500) message = `${message.slice(0, 500)}…`;
    const status = typeof err?.status === 'number' ? err.status : undefined;
    return new AiError(message, status === undefined ? {} : { status });
  }
}

/** Our request as the SDK's `models.generateContent` parameters. Pure. */
export function toGeminiRequest(model: string, req: AiRequest): GenerateContentParameters {
  const config: GenerateContentConfig = {
    systemInstruction: req.system,
    temperature: AI_TEMPERATURE,
    maxOutputTokens: req.maxOutputTokens,
    candidateCount: 1,
    automaticContinuation: false,
  };
  if (req.tools && req.tools.length > 0) {
    config.tools = [{
      functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })),
    }];
    config.toolConfig = { functionCallingConfig: { mode: TOOL_MODES[req.toolMode ?? 'auto'] } };
  }
  if (req.responseSchema) {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = req.responseSchema;
  }
  if (req.thinking) {
    config.thinkingConfig = { thinkingLevel: req.thinking === 'minimal' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW };
  }
  if (req.timeoutMs !== undefined) {
    config.httpOptions = { timeout: req.timeoutMs };
  }
  if (req.signal) {
    // The SDK (2.30.0) passes config.abortSignal to fetch with the timeout's own signal.
    config.abortSignal = req.signal;
  }
  return { model, contents: joinUserContents(req.turns.map(toContent)), config };
}

const TOOL_MODES: Record<NonNullable<AiRequest['toolMode']>, FunctionCallingConfigMode> = {
  auto: FunctionCallingConfigMode.AUTO,
  validated: FunctionCallingConfigMode.VALIDATED,
  none: FunctionCallingConfigMode.NONE,
};

/**
 * Two user contents in a row (a tool turn's function responses, then a text turn) become
 * one, parts in order: the roles must alternate. Model contents are never joined (their
 * signed parts must stay as they came).
 */
function joinUserContents(contents: Content[]): Content[] {
  const out: Content[] = [];
  for (const c of contents) {
    const last = out.at(-1);
    if (last && last.role === 'user' && c.role === 'user') {
      out[out.length - 1] = { role: 'user', parts: [...(last.parts ?? []), ...(c.parts ?? [])] };
    } else {
      out.push(c);
    }
  }
  return out;
}

function toContent(turn: AiTurn): Content {
  if (turn.role === 'tool') {
    return {
      role: 'user',
      parts: (turn.results ?? []).map((r) => ({
        functionResponse: { ...(r.id !== undefined ? { id: r.id } : {}), name: r.name, response: isPlainObject(r.result) ? r.result : { output: r.result } },
      })),
    };
  }
  if (turn.role === 'model' && Array.isArray(turn.raw)) {
    return { role: 'model', parts: turn.raw as Part[] };
  }
  const parts: Part[] = [];
  if (turn.text !== undefined) parts.push({ text: turn.text });
  for (const c of turn.calls ?? []) {
    parts.push({ functionCall: { ...(c.id !== undefined ? { id: c.id } : {}), name: c.name, args: isPlainObject(c.args) ? c.args : {} } });
  }
  return { role: turn.role, parts };
}

/** The SDK's response as ours. Pure. */
export function fromGeminiResponse(res: GeminiResponseShape): AiResponse {
  const usage = res.usageMetadata;
  const inputTokens = (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0);
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const blocked = (blockReason: string): AiResponse => ({ text: null, calls: [], inputTokens, outputTokens, blocked: true, blockReason });

  if (res.promptFeedback?.blockReason) return blocked(`prompt:${res.promptFeedback.blockReason}`);
  const candidate = res.candidates?.[0];
  if (!candidate) return blocked('no_candidate');
  if (candidate.finishReason !== FinishReason.STOP) return blocked(candidate.finishReason ?? 'unfinished');
  const unsafe = candidate.safetyRatings?.find((r) => r.blocked === true);
  if (unsafe) return blocked(`safety:${unsafe.category ?? 'unknown'}`);

  const parts = candidate.content?.parts ?? [];
  let text: string | null = null;
  const calls: AiCall[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string' && part.thought !== true) text = (text ?? '') + part.text;
    if (part.functionCall?.name) {
      const fc = part.functionCall;
      calls.push({ ...(fc.id !== undefined ? { id: fc.id } : {}), name: fc.name!, args: fc.args ?? {} });
    }
  }
  if (text === '') text = null;
  // Finished, but nothing in it: never an answer, and never a model turn to send back.
  if (text === null && calls.length === 0) return blocked('empty');
  return { text, calls, inputTokens, outputTokens, blocked: false, raw: parts };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
