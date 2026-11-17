import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { trustProxyOf } from '../src/trustProxy.js';

// Which proxies' x-forwarded-* the server takes (src/trustProxy.ts): a hop count alone let a client that reaches the
// server directly write them itself (GHSA-444r-cwp2-x5xf).
describe('the proxies the server trusts', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  /** A server trusting as buildServer does, answering what it read of the request */
  async function server(hops = 1, addresses?: string[]) {
    await app?.close();
    const instance = Fastify({ trustProxy: trustProxyOf(hops, addresses) });
    instance.get('/who', async (request: FastifyRequest) => ({ ip: request.ip, protocol: request.protocol, host: request.host }));
    await instance.ready();
    app = instance;
    return instance;
  }
  const ask = async (remoteAddress: string, headers: Record<string, string>, hops = 1, addresses?: string[]) =>
    (await (await server(hops, addresses)).inject({ method: 'GET', url: '/who', remoteAddress, headers: { host: 'internal:8080', ...headers } })).json();
  const forwarded = { 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'cloud.example.org' };

  it("behind Cloud Run's front end (a link-local address): the client, and the public protocol and host", async () => {
    expect(await ask('169.254.8.129', forwarded)).toEqual({ ip: '203.0.113.7', protocol: 'https', host: 'cloud.example.org' });
  });

  it('behind Caddy on the containers\' network, or on this computer: the same', async () => {
    expect((await ask('172.18.0.5', forwarded)).ip).toBe('203.0.113.7');
    expect((await ask('127.0.0.1', forwarded)).ip).toBe('203.0.113.7');
  });

  it('a client reaching the server directly cannot write them: its own address, protocol and host', async () => {
    expect(await ask('198.51.100.20', forwarded)).toEqual({ ip: '198.51.100.20', protocol: 'http', host: 'internal:8080' });
  });

  it('only as many proxies as TRUST_PROXY_HOPS: an address a client wrote before them never counts', async () => {
    // One proxy: the entry it added (203.0.113.7), not the client's own 6.6.6.6
    expect((await ask('10.0.0.2', { 'x-forwarded-for': '6.6.6.6, 10.0.0.9, 203.0.113.7' })).ip).toBe('203.0.113.7');
    // Two (a load balancer, then Caddy): the entry the first one added
    expect((await ask('10.0.0.2', { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.0.0.9' }, 2)).ip).toBe('203.0.113.7');
  });

  it('TRUST_PROXY_ADDRESSES names the proxies instead: another one is a client', async () => {
    expect((await ask('192.0.2.10', forwarded, 1, ['192.0.2.10'])).ip).toBe('203.0.113.7');
    expect((await ask('169.254.8.129', forwarded, 1, ['192.0.2.10'])).ip).toBe('169.254.8.129');
  });

  it('TRUST_PROXY_ADDRESSES is read at start, and refused when it is no list of addresses', () => {
    expect(loadConfig({}).trustProxyAddresses).toBeUndefined();
    expect(loadConfig({ TRUST_PROXY_ADDRESSES: ' 10.0.0.0/8, loopback ' }).trustProxyAddresses).toEqual(['10.0.0.0/8', 'loopback']);
    expect(() => loadConfig({ TRUST_PROXY_ADDRESSES: 'proxy.example.org' })).toThrow(/TRUST_PROXY_ADDRESSES/);
  });
});
