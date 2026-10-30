import { describe, expect, it } from 'vitest';
import { aiResponse, scripted } from './fakeClient.js';

describe('scripted', () => {
  it('returns the responses in order and records each request', async () => {
    const fake = scripted([aiResponse({ text: 'one' }), aiResponse({ calls: [{ name: 'get_people', args: {} }] })]);
    const r1 = await fake.generate({ system: 's', turns: [{ role: 'user', text: 'a' }], maxOutputTokens: 1 });
    const r2 = await fake.generate({ system: 's', turns: [{ role: 'user', text: 'b' }], maxOutputTokens: 2 });
    expect(r1.text).toBe('one');
    expect(r2.calls).toEqual([{ name: 'get_people', args: {} }]);
    expect(fake.requests.map((r) => r.maxOutputTokens)).toEqual([1, 2]);
  });

  it('keeps a copy of each request, so later changes to the turns do not change it', async () => {
    const fake = scripted([aiResponse(), aiResponse()]);
    const turns = [{ role: 'user' as const, text: 'a' }];
    await fake.generate({ system: 's', turns, maxOutputTokens: 1 });
    turns.push({ role: 'user', text: 'b' });
    expect(fake.requests[0]!.turns).toHaveLength(1);
  });

  it('fails when it runs out of responses', async () => {
    const fake = scripted([]);
    await expect(fake.generate({ system: 's', turns: [], maxOutputTokens: 1 })).rejects.toThrow(/no more scripted responses/);
  });
});
