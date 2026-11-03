import { describe, expect, it } from 'vitest';
import { FinishReason, FunctionCallingConfigMode, ThinkingLevel, type GenerateContentParameters } from '@google/genai';
import type { AiRequest } from '../../src/ai/client.js';
import { AiError, modelTurn } from '../../src/ai/client.js';
import {
  AI_TEMPERATURE,
  AI_TIMEOUT_MS,
  GeminiClient,
  fromGeminiResponse,
  geminiClientOptions,
  toGeminiRequest,
  type GeminiResponseShape,
} from '../../src/ai/gemini.js';
import type { Config } from '../../src/config.js';

const SECRET = 'AIzaSy-very-secret-vertex-key-0123456789';

const TOOL = {
  name: 'get_confusions',
  description: 'Confusion counts for one question.',
  parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
};

function baseConfig(ai: Partial<Config>): Config {
  return { aiVertexRegion: 'global', aiModel: 'gemini-3.8-flash', ...ai } as Config;
}

describe('geminiClientOptions', () => {
  it('uses Vertex AI with the API key alone when there is a key', () => {
    const o = geminiClientOptions(baseConfig({ aiVertexApiKey: SECRET, aiVertexProject: 'p', aiConfigured: true }));
    expect(o).toEqual({ enterprise: true, apiKey: SECRET, httpOptions: { timeout: AI_TIMEOUT_MS } });
  });

  it('uses Vertex AI with the project and region (the service account) when there is no key', () => {
    const o = geminiClientOptions(baseConfig({ aiVertexProject: 'my-gcp-project', aiVertexRegion: 'europe-west4', aiConfigured: true }));
    expect(o).toEqual({ enterprise: true, project: 'my-gcp-project', location: 'europe-west4', httpOptions: { timeout: AI_TIMEOUT_MS } });
  });

  it('has a 60 s timeout and no retries', () => {
    const o = geminiClientOptions(baseConfig({ aiVertexApiKey: SECRET, aiConfigured: true }));
    expect(AI_TIMEOUT_MS).toBe(60_000);
    expect(o.httpOptions?.retryOptions).toBeUndefined();
  });

  it('refuses a config with neither, without naming any value', () => {
    expect(() => geminiClientOptions(baseConfig({}))).toThrow(AiError);
  });
});

describe('toGeminiRequest', () => {
  const req: AiRequest = {
    system: 'You review data quality.',
    turns: [
      { role: 'user', text: 'Review this project.' },
      { role: 'model', calls: [{ id: 'c1', name: 'get_confusions', args: { question: 'land_use' } }] },
      { role: 'tool', results: [{ id: 'c1', name: 'get_confusions', result: { project_data: { a: 1 }, note: 'data' } }] },
      { role: 'model', text: 'Done.' },
    ],
    tools: [TOOL],
    maxOutputTokens: 4096,
  };

  it('maps the turns to contents with user and model roles', () => {
    const p = toGeminiRequest('gemini-3.8-flash', req);
    expect(p.model).toBe('gemini-3.8-flash');
    expect(p.contents).toEqual([
      { role: 'user', parts: [{ text: 'Review this project.' }] },
      { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'get_confusions', args: { question: 'land_use' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'get_confusions', response: { project_data: { a: 1 }, note: 'data' } } }] },
      { role: 'model', parts: [{ text: 'Done.' }] },
    ]);
  });

  it('sends the raw parts of a model turn back unchanged (thought signatures)', () => {
    const raw = [
      { functionCall: { id: 'c1', name: 'get_people', args: {} }, thoughtSignature: 'c2lnbmF0dXJl' },
      { functionCall: { id: 'c2', name: 'get_agreement', args: {} } },
    ];
    const p = toGeminiRequest('m', {
      system: 's',
      maxOutputTokens: 10,
      turns: [
        { role: 'user', text: 'go' },
        { role: 'model', calls: [{ id: 'c1', name: 'get_people', args: {} }, { id: 'c2', name: 'get_agreement', args: {} }], raw },
        { role: 'tool', results: [{ id: 'c1', name: 'get_people', result: [1] }, { id: 'c2', name: 'get_agreement', result: 'x' }] },
      ],
    });
    const contents = p.contents as { role: string; parts: unknown[] }[];
    expect(contents[1]).toEqual({ role: 'model', parts: raw });
    // All responses in one user content, in the calls' order; a value that is not an object goes under "output".
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { id: 'c1', name: 'get_people', response: { output: [1] } } },
        { functionResponse: { id: 'c2', name: 'get_agreement', response: { output: 'x' } } },
      ],
    });
  });

  it('declares only our functions, in AUTO mode, with a low temperature and the output cap', () => {
    const p = toGeminiRequest('m', req);
    expect(p.config).toEqual({
      systemInstruction: 'You review data quality.',
      temperature: AI_TEMPERATURE,
      maxOutputTokens: 4096,
      candidateCount: 1,
      automaticContinuation: false,
      tools: [{ functionDeclarations: [{ name: TOOL.name, description: TOOL.description, parametersJsonSchema: TOOL.parameters }] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
    });
    expect(AI_TEMPERATURE).toBe(0.2);
    // No Google Search, code execution or URL context: one tool entry, function declarations only.
    const tools = p.config!.tools as object[];
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]!)).toEqual(['functionDeclarations']);
  });

  it('asks for JSON with the schema, and sends no tools when there are none', () => {
    const schema = { type: 'object', properties: { on_topic: { type: 'boolean' } }, required: ['on_topic'] };
    const p: GenerateContentParameters = toGeminiRequest('m', {
      system: 's',
      turns: [{ role: 'user', text: 'q' }],
      responseSchema: schema,
      maxOutputTokens: 256,
    });
    expect(p.config).toEqual({
      systemInstruction: 's',
      temperature: 0.2,
      maxOutputTokens: 256,
      candidateCount: 1,
      automaticContinuation: false,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    });
    expect(p.config).not.toHaveProperty('tools');
    expect(p.config).not.toHaveProperty('toolConfig');
  });

  it('treats an empty tool list as no tools', () => {
    const p = toGeminiRequest('m', { system: 's', turns: [{ role: 'user', text: 'q' }], tools: [], maxOutputTokens: 1 });
    expect(p.config).not.toHaveProperty('tools');
  });

  it('sends the tool mode, the thinking level and the per-call timeout', () => {
    const base = { system: 's', turns: [{ role: 'user' as const, text: 'q' }], tools: [TOOL], maxOutputTokens: 1 };
    expect(toGeminiRequest('m', { ...base, toolMode: 'validated' }).config!.toolConfig).toEqual({
      functionCallingConfig: { mode: FunctionCallingConfigMode.VALIDATED },
    });
    const final = toGeminiRequest('m', { ...base, toolMode: 'none', responseSchema: { type: 'object' }, thinking: 'low', timeoutMs: 170_000 }).config!;
    expect(final.toolConfig).toEqual({ functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } });
    expect(final.tools).toHaveLength(1);
    expect(final.responseJsonSchema).toEqual({ type: 'object' });
    expect(final.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.LOW });
    expect(final.httpOptions).toEqual({ timeout: 170_000 });
    expect(toGeminiRequest('m', { ...base, thinking: 'minimal' }).config!.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(toGeminiRequest('m', base).config).not.toHaveProperty('httpOptions');
    expect(toGeminiRequest('m', base).config).not.toHaveProperty('thinkingConfig');
  });

  it('passes the abort signal to the SDK, which cancels the HTTP call with it', () => {
    const base = { system: 's', turns: [{ role: 'user' as const, text: 'q' }], maxOutputTokens: 1 };
    const signal = new AbortController().signal;
    expect(toGeminiRequest('m', { ...base, signal }).config!.abortSignal).toBe(signal);
    expect(toGeminiRequest('m', base).config).not.toHaveProperty('abortSignal');
  });

  it('never sends two user contents in a row: a text after the tool results joins their content', () => {
    const p = toGeminiRequest('m', {
      system: 's',
      maxOutputTokens: 1,
      turns: [
        { role: 'user', text: 'go' },
        { role: 'model', calls: [{ id: 'c1', name: 'get_people', args: {} }] },
        { role: 'tool', results: [{ id: 'c1', name: 'get_people', result: { a: 1 } }] },
        { role: 'user', text: 'Now the report.' },
        { role: 'user', text: 'And in JSON.' },
      ],
    });
    expect((p.contents as { role: string }[]).map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect((p.contents as { parts: unknown[] }[])[2].parts).toEqual([
      { functionResponse: { id: 'c1', name: 'get_people', response: { a: 1 } } },
      { text: 'Now the report.' },
      { text: 'And in JSON.' },
    ]);
  });

  it('keeps a model turn with text and calls in that order, and sends call ids only when known', () => {
    const p = toGeminiRequest('m', {
      system: 's',
      maxOutputTokens: 1,
      turns: [{ role: 'model', text: 'Looking.', calls: [{ name: 'get_people', args: {} }] }],
    });
    expect(p.contents).toEqual([{ role: 'model', parts: [{ text: 'Looking.' }, { functionCall: { name: 'get_people', args: {} } }] }]);
  });
});

/** A recorded response, shaped as the SDK's GenerateContentResponse. */
function response(over: Partial<GeminiResponseShape> = {}): GeminiResponseShape {
  return {
    candidates: [
      {
        index: 0,
        finishReason: FinishReason.STOP,
        content: { role: 'model', parts: [{ text: '{"on_topic":' }, { text: 'true}' }] },
        safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT' as never, probability: 'NEGLIGIBLE' as never }],
      },
    ],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 40, thoughtsTokenCount: 300, totalTokenCount: 1540 },
    ...over,
  };
}

describe('fromGeminiResponse', () => {
  it('joins the text parts and counts thinking tokens as output', () => {
    const r = fromGeminiResponse(response());
    expect(r).toMatchObject({ text: '{"on_topic":true}', calls: [], inputTokens: 1200, outputTokens: 340, blocked: false });
  });

  it('returns function calls with ids, keeps the raw parts, and leaves out thought text', () => {
    const parts = [
      { text: 'thinking...', thought: true },
      { functionCall: { id: 'a', name: 'get_people', args: {} }, thoughtSignature: 'c2ln' },
      { functionCall: { name: 'get_confusions', args: { question: 'land_use' } } },
    ];
    const r = fromGeminiResponse(response({
      candidates: [{ finishReason: FinishReason.STOP, content: { role: 'model', parts } }],
    }));
    expect(r.text).toBeNull();
    expect(r.calls).toEqual([
      { id: 'a', name: 'get_people', args: {} },
      { name: 'get_confusions', args: { question: 'land_use' } },
    ]);
    expect(r.raw).toEqual(parts);
    expect(r.blocked).toBe(false);
    // The run turns the response into the next model turn, signatures included.
    expect(modelTurn(r)).toEqual({ role: 'model', calls: r.calls, raw: parts });
  });

  it('is blocked as empty when it finished with nothing but thoughts, or no parts at all', () => {
    for (const parts of [[], [{ text: 'hmm', thought: true }], [{ text: '' }]]) {
      const r = fromGeminiResponse(response({ candidates: [{ finishReason: FinishReason.STOP, content: { role: 'model', parts } }] }));
      expect(r).toMatchObject({ text: null, calls: [], blocked: true, blockReason: 'empty', inputTokens: 1200 });
    }
    expect(fromGeminiResponse(response({ candidates: [{ finishReason: FinishReason.STOP }] }))).toMatchObject({ blocked: true, blockReason: 'empty' });
  });

  it('adds tool-use prompt tokens to the input and treats missing counts as 0', () => {
    expect(fromGeminiResponse(response({ usageMetadata: { promptTokenCount: 10, toolUsePromptTokenCount: 5 } })))
      .toMatchObject({ inputTokens: 15, outputTokens: 0 });
    expect(fromGeminiResponse(response({ usageMetadata: undefined }))).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it('is blocked when the prompt was blocked, keeping the tokens', () => {
    const r = fromGeminiResponse({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' as never }, usageMetadata: { promptTokenCount: 50 } });
    expect(r).toEqual({ text: null, calls: [], inputTokens: 50, outputTokens: 0, blocked: true, blockReason: 'prompt:PROHIBITED_CONTENT' });
  });

  it.each([
    FinishReason.SAFETY, FinishReason.MAX_TOKENS, FinishReason.RECITATION, FinishReason.MALFORMED_FUNCTION_CALL,
    FinishReason.OTHER, FinishReason.PROHIBITED_CONTENT, FinishReason.SPII, FinishReason.TOO_MANY_TOOL_CALLS,
    FinishReason.CONTINUATION,
  ])('is blocked when the model stopped with %s, with no text or calls', (reason) => {
    const r = fromGeminiResponse(response({
      candidates: [{ finishReason: reason, content: { role: 'model', parts: [{ text: '{"summ' }, { functionCall: { name: 'x', args: {} } }] } }],
    }));
    expect(r).toMatchObject({ text: null, calls: [], blocked: true, blockReason: reason, inputTokens: 1200, outputTokens: 340 });
    expect(r.raw).toBeUndefined();
  });

  it('is blocked when a safety rating says so, or there is no candidate or no finish reason', () => {
    expect(fromGeminiResponse(response({
      candidates: [{ finishReason: FinishReason.STOP, content: { role: 'model', parts: [{ text: 'x' }] }, safetyRatings: [{ blocked: true, category: 'HARM_CATEGORY_HATE_SPEECH' as never }] }],
    }))).toMatchObject({ blocked: true, blockReason: 'safety:HARM_CATEGORY_HATE_SPEECH', text: null });
    expect(fromGeminiResponse(response({ candidates: [] }))).toMatchObject({ blocked: true, blockReason: 'no_candidate' });
    expect(fromGeminiResponse(response({ candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }] })))
      .toMatchObject({ blocked: true, blockReason: 'unfinished' });
  });
});

describe('GeminiClient', () => {
  it('sends the mapped request once and maps the answer', async () => {
    const sent: GenerateContentParameters[] = [];
    const client = new GeminiClient({ generateContent: async (p) => { sent.push(p); return response(); } }, 'gemini-3.8-flash');
    const req: AiRequest = { system: 's', turns: [{ role: 'user', text: 'q' }], maxOutputTokens: 100 };
    const r = await client.generate(req);
    expect(sent).toEqual([toGeminiRequest('gemini-3.8-flash', req)]);
    expect(r).toMatchObject({ text: '{"on_topic":true}', blocked: false });
  });

  it('turns an SDK error into an AiError with the status and without the key', async () => {
    const err = Object.assign(new Error(`got status: 403 Forbidden. {"error":{"message":"API key ${SECRET} not valid"}}`), { status: 403, apiKey: SECRET });
    const client = new GeminiClient({ generateContent: async () => { throw err; } }, 'm', SECRET);
    const e = await client.generate({ system: 's', turns: [], maxOutputTokens: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).status).toBe(403);
    expect(JSON.stringify(e)).not.toContain(SECRET);
    expect(String((e as AiError).message)).not.toContain(SECRET);
    expect((e as AiError).message).toContain('[key]');
    expect((e as Error).cause).toBeUndefined();
  });

  it('calls a timeout a timeout', async () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const client = new GeminiClient({ generateContent: async () => { throw abort; } }, 'm');
    const e = await client.generate({ system: 's', turns: [], maxOutputTokens: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).timeout).toBe(true);
    const long = await client.generate({ system: 's', turns: [], maxOutputTokens: 1, timeoutMs: 170_000 }).catch((x: unknown) => x);
    expect((long as AiError).message).toContain('170 s');
  });

  it('stops the call when the signal is aborted, as a timeout', async () => {
    const client = new GeminiClient(
      {
        generateContent: (params) =>
          new Promise((_, reject) => {
            params.config!.abortSignal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      },
      'm',
    );
    const controller = new AbortController();
    const pending = client.generate({ system: 's', turns: [], maxOutputTokens: 1, signal: controller.signal }).catch((x: unknown) => x);
    controller.abort();
    const e = await pending;
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).timeout).toBe(true);
  });
});
