// Which proxies' x-forwarded-* headers the server takes (the client IP for rate limiting, the public protocol and host
// for the links it writes). A hop count alone let a client that reaches the server directly write those headers
// itself (GHSA-444r-cwp2-x5xf; Fastify 5 refuses a bare count): each hop must also come from a proxy's address.
import proxyAddr from '@fastify/proxy-addr';

/**
 * The addresses proxies connect from by default: this computer (local mode, a proxy on the same host), link-local
 * (Cloud Run's front end) and the private networks (Caddy or a load balancer on the containers' network).
 */
export const PRIVATE_PROXIES = ['loopback', 'linklocal', 'uniquelocal'] as const;

/** Throws on an address or range proxy-addr does not read (TRUST_PROXY_ADDRESSES is checked at start). */
export function trustedAddresses(list: readonly string[]): (address: string, hop: number) => boolean {
  return proxyAddr.compile([...list]);
}

/**
 * Fastify's trustProxy: at most `hops` proxies, the nearest first, each from one of `addresses` (IPs, CIDR ranges, or
 * proxy-addr's names loopback, linklocal and uniquelocal). The client IP is then the first address that is not one.
 */
export function trustProxyOf(hops: number, addresses: readonly string[] = PRIVATE_PROXIES): (address: string, hop: number) => boolean {
  const trusted = trustedAddresses(addresses);
  return (address, hop) => hop < hops && trusted(address, hop);
}
