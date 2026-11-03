/**
 * A small interface to the AI model, so the assistant's run (Task 14) does not depend
 * on one SDK and tests can use a scripted fake (`test/ai/fakeClient.ts`). The Gemini
 * implementation is `gemini.ts`.
 */

/** One of our read-only functions, offered to the model. */
export interface AiTool {
  name: string;
  description: string;
  /** The arguments, as a JSON schema of an object. */
  parameters: object;
}

/** A function call the model asked for. */
export interface AiCall {
  /** The model's id for the call, when it gives one; the result is sent back with it. */
  id?: string;
  name: string;
  args: unknown;
}

/** Our answer to one call. */
export interface AiResult {
  id?: string;
  name: string;
  /** A JSON value. An object is sent as it is; anything else as `{ output: <value> }`. */
  result: unknown;
}

export interface AiTurn {
  /** `tool` carries the results of the calls of the model turn just before it. */
  role: 'user' | 'model' | 'tool';
  text?: string;
  calls?: AiCall[];
  results?: AiResult[];
  /**
   * For a model turn: the model's own answer as it came (`AiResponse.raw`). It is sent
   * back exactly as it is, instead of `text` and `calls`, because Gemini 3 needs the
   * thought signatures it put on its function calls. Opaque: never read or change it.
   */
  raw?: unknown;
}

export interface AiRequest {
  system: string;
  turns: AiTurn[];
  /** Our functions only. None (or empty) = the model can only answer. */
  tools?: AiTool[];
  /** A JSON schema: the answer is JSON text that should follow it (always check it). */
  responseSchema?: object;
  maxOutputTokens: number;
  /**
   * With tools: `auto` (the model calls them or answers), `validated` (the same, with
   * calls checked against the declarations by the service) or `none` (they are declared
   * but cannot be called, e.g. for a final structured answer). Default `auto`.
   */
  toolMode?: 'auto' | 'validated' | 'none';
  /** How much the model may think before answering. Default: the model's own. */
  thinking?: 'minimal' | 'low';
  /** This call's time limit; default the client's (60 s). */
  timeoutMs?: number;
  /**
   * Cancels the call when aborted (the run's time limit): the client stops waiting and
   * closes the HTTP request. The service may still finish, and bill, a call it had begun.
   */
  signal?: AbortSignal;
}

export interface AiResponse {
  /** The answer's text, without the model's thoughts; null when there is none or it was blocked. */
  text: string | null;
  /** Empty when blocked. */
  calls: AiCall[];
  inputTokens: number;
  /** The answer's tokens plus the model's thinking tokens (both are billed as output). */
  outputTokens: number;
  /**
   * The answer can't be used: a safety block, or the model stopped for any reason other
   * than finishing (including running out of output tokens). Text and calls are then empty.
   */
  blocked: boolean;
  /** Why it was blocked, as the model's service says it, e.g. `MAX_TOKENS` or `prompt:SAFETY`. */
  blockReason?: string;
  /** The model's answer as it came, to send back in the next model turn. Opaque. */
  raw?: unknown;
}

export interface AiClient {
  /** One call to the model, never retried here: the run decides what to do on an error. */
  generate(req: AiRequest): Promise<AiResponse>;
}

/** The model turn to add to the conversation after a response. */
export function modelTurn(res: AiResponse): AiTurn {
  const turn: AiTurn = { role: 'model' };
  if (res.text !== null) turn.text = res.text;
  if (res.calls.length > 0) turn.calls = res.calls;
  if (res.raw !== undefined) turn.raw = res.raw;
  return turn;
}

/** The call to the model failed (network, timeout, an error from the service). Never holds the key. */
export class AiError extends Error {
  /** The HTTP status, when the service answered with an error. */
  readonly status?: number;
  /** The call took longer than the client's timeout. */
  readonly timeout: boolean;

  constructor(message: string, opts: { status?: number; timeout?: boolean } = {}) {
    super(message);
    this.name = 'AiError';
    if (opts.status !== undefined) this.status = opts.status;
    this.timeout = opts.timeout === true;
  }
}
