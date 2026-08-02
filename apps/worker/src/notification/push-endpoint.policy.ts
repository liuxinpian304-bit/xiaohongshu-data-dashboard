import { lookup } from 'node:dns/promises';

const DEFAULT_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];

export class PushEndpointPolicy {
  constructor(private readonly allowedHostSuffixes = configuredHosts(), private readonly resolve: (host: string) => Promise<string[]> = resolveAddresses) {}

  assertAllowed(endpoint: string): URL {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error('push endpoint must be a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) throw new Error('push endpoint must use HTTPS port 443');
    if (url.username || url.password) throw new Error('push endpoint credentials are forbidden');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (isUnsafeAddress(host)) throw new Error('private or local push endpoints are forbidden');
    if (!this.allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) throw new Error('push endpoint host is not allowed');
    return url;
  }
  async assertResolvedAllowed(endpoint: string) {
    const url = this.assertAllowed(endpoint);
    const addresses = await this.resolve(url.hostname);
    if (!addresses.length || addresses.some(isUnsafeAddress)) throw new Error('private or local push destination is forbidden');
    return url;
  }
}

async function resolveAddresses(host: string) { return (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address); }

function configuredHosts() {
  const configured = process.env.WEB_PUSH_ALLOWED_HOST_SUFFIXES?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_PUSH_HOST_SUFFIXES;
}

function isUnsafeAddress(host: string) {
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
