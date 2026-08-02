import { Agent } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

export const DEFAULT_WEB_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com', 'push.services.mozilla.com', 'updates.push.services.mozilla.com',
  'web.push.apple.com', 'notify.windows.com',
] as const;

export interface PinnedPushEndpoint { url: URL; address: string; agent: Agent }

export class PushEndpointPolicy {
  constructor(
    private readonly allowedHostSuffixes: readonly string[] = DEFAULT_WEB_PUSH_HOST_SUFFIXES,
    private readonly resolve: (host: string) => Promise<string[]> = resolveAddresses,
  ) {}

  assertAllowed(endpoint: string) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error('push endpoint must be a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) throw new Error('push endpoint violates HTTPS policy');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (isIP(host) || !this.allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) throw new Error('push endpoint host is not allowed');
    return url;
  }

  async resolveAndPin(endpoint: string): Promise<PinnedPushEndpoint> {
    const url = this.assertAllowed(endpoint);
    const addresses = await this.resolve(url.hostname);
    if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new Error('push endpoint must resolve only to public addresses');
    const address = addresses[0]!;
    const pinned = addresses.map((candidate) => ({ address: candidate, family: isIP(candidate) as 4 | 6 }));
    const lookup = ((_hostname, options, callback) => {
      const request = typeof options === 'number' ? { family: options } : options;
      if (request?.all) { callback(null, pinned); return; }
      const requestedFamily = request?.family ?? 0;
      const selected = requestedFamily === 0 ? pinned[0] : pinned.find((candidate) => candidate.family === requestedFamily);
      if (!selected) { (callback as (error: Error) => void)(new Error(`pinned push endpoint has no address for family ${requestedFamily}`)); return; }
      callback(null, selected.address, selected.family);
    }) as LookupFunction;
    return { url, address, agent: new Agent({ keepAlive: false, maxCachedSessions: 0, lookup }) };
  }
}

async function resolveAddresses(host: string) { return (await dnsLookup(host, { all: true, verbatim: true })).map(({ address }) => address); }

export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^(?:::ffff:|(?:0:){5}ffff:)(.+)$/)?.[1];
  if (mapped) return isPublicIpv4(mapped.includes(':') ? mappedHexToIpv4(mapped) : mapped);
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const first = Number.parseInt(address.split(':')[0] || '0', 16);
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  if ((first & 0xe000) !== 0x2000) return false;
  if (normalized.startsWith('2001:db8:')) return false;
  return true;
}

function isPublicIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && c <= 2))) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
}

function mappedHexToIpv4(value: string) {
  const [high = '0', low = '0'] = value.split(':');
  const number = (Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16);
  return [number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join('.');
}
