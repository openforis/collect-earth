import type { AiClient, AiRequest, AiResponse } from '../../src/ai/client.js';

export interface ScriptedClient extends AiClient {
  /** Every request sent, in order, as a deep copy taken when it was sent. */
  readonly requests: AiRequest[];
}

/** An AI client that answers with `responses` in order and records what it was sent. */
export function scripted(responses: AiResponse[]): ScriptedClient {
  const queue = [...responses];
  const requests: AiRequest[] = [];
  return {
    requests,
    async generate(req: AiRequest): Promise<AiResponse> {
      requests.push(structuredClone(req));
      const next = queue.shift();
      if (!next) throw new Error(`scripted AI client: no more scripted responses (request ${requests.length})`);
      return next;
    },
  };
}

/** A response that finished normally, with the given fields. */
export function aiResponse(over: Partial<AiResponse> = {}): AiResponse {
  return { text: null, calls: [], inputTokens: 100, outputTokens: 10, blocked: false, ...over };
}
