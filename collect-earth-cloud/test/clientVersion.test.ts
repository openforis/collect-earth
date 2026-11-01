import { describe, expect, it } from 'vitest';
import { isCollectEarthAgent, parseClientAgent } from '../src/clientVersion.js';

describe('parseClientAgent', () => {
  it('reads the version Collect Earth sends; any version sent hides checks', () => {
    expect(parseClientAgent('CollectEarth/1.24.3 cloud-sync')).toEqual({ kind: 'collect-earth', version: '1.24.3', hidesChecks: true });
    expect(parseClientAgent('CollectEarth/0.00.00 cloud-sync')).toEqual({ kind: 'collect-earth', version: '0.00.00', hidesChecks: true });
    expect(parseClientAgent('CollectEarth/1.22.0 (Windows 11; Java 23)')).toEqual({ kind: 'collect-earth', version: '1.22.0', hidesChecks: true });
  });

  it('a Collect Earth that could not read its version is a new one without a version', () => {
    expect(parseClientAgent('CollectEarth/unknown cloud-sync')).toEqual({ kind: 'collect-earth', version: null, hidesChecks: true });
  });

  it('the agent of the releases before the version was sent is an old Collect Earth', () => {
    expect(parseClientAgent('CollectEarth-cloud-sync')).toEqual({ kind: 'old-collect-earth' });
  });

  it('anything else is unknown, never old', () => {
    for (const agent of [
      null,
      undefined,
      '',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
      'curl/8.4.0',
      'CollectEarth/',
      'collectearth/1.0 cloud-sync',
      'Something CollectEarth/1.0',
      'CollectEarth-cloud-sync-2',
    ]) {
      expect(parseClientAgent(agent)).toEqual({ kind: 'unknown' });
    }
  });
});

describe('isCollectEarthAgent', () => {
  it('is true for both forms of Collect Earth agent only', () => {
    expect(isCollectEarthAgent('CollectEarth/1.24.3 cloud-sync')).toBe(true);
    expect(isCollectEarthAgent('CollectEarth/unknown cloud-sync')).toBe(true);
    expect(isCollectEarthAgent('CollectEarth-cloud-sync')).toBe(true);
    expect(isCollectEarthAgent('Mozilla/5.0 Chrome/130.0')).toBe(false);
    expect(isCollectEarthAgent(null)).toBe(false);
  });
});
