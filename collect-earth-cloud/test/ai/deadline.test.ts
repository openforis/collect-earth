import { describe, expect, it } from 'vitest';
import { AiError, type AiClient, type AiRequest } from '../../src/ai/client.js';
import { withDeadline } from '../../src/ai/service.js';

const REQ: AiRequest = { system: 's', turns: [], maxOutputTokens: 1, timeoutMs: 60_000 };

describe('withDeadline', () => {
  it('cancels the call in flight when the run reaches its time limit, through the abort signal', async () => {
    let seen: AiRequest | null = null;
    const hanging: AiClient = {
      generate: (req) => {
        seen = req;
        return new Promise(() => {});
      },
    };
    const e = await withDeadline(hanging, Date.now() + 1100).generate(REQ).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).timeout).toBe(true);
    expect(seen!.signal).toBeInstanceOf(AbortSignal);
    expect(seen!.signal!.aborted).toBe(true);
    // The call's own time limit is cut to what is left of the run.
    expect(seen!.timeoutMs).toBeLessThanOrEqual(1100);
  });

  it('leaves the signal alone when the call ends in time, and starts no call after the deadline', async () => {
    let seen: AiRequest | null = null;
    const quick: AiClient = {
      generate: async (req) => {
        seen = req;
        return { text: 'ok', calls: [], inputTokens: 1, outputTokens: 1, blocked: false };
      },
    };
    expect((await withDeadline(quick, Date.now() + 60_000).generate(REQ)).text).toBe('ok');
    expect(seen!.signal!.aborted).toBe(false);
    seen = null;
    await expect(withDeadline(quick, Date.now() + 500).generate(REQ)).rejects.toThrow(/time limit/);
    expect(seen).toBeNull();
  });
});
