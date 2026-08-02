import { lookup } from 'node:dns/promises';

export class PushEndpointPolicy {
  constructor(private readonly allowedHostSuffixes = (process.env.WEB_PUSH_ALLOWED_HOST_SUFFIXES ?? 'fcm.googleapis.com,push.services.mozilla.com,updates.push.services.mozilla.com,web.push.apple.com,notify.windows.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean), private readonly resolve: (host: string) => Promise<string[]> = resolveAddresses) {}
  assertAllowed(endpoint: string) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error('endpoint must be a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) throw new Error('endpoint violates Web Push URL policy');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || privateIpv4(host)) throw new Error('endpoint is private or local');
    if (!this.allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) throw new Error('endpoint host is not allowed');
    return url;
  }
  async assertResolvedAllowed(endpoint: string) { const url = this.assertAllowed(endpoint); const addresses = await this.resolve(url.hostname); if (!addresses.length || addresses.some(unsafeAddress)) throw new Error('endpoint resolves to a private or local address'); }
}

async function resolveAddresses(host: string) { return (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address); }
function unsafeAddress(address: string) { return address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd') || privateIpv4(address); }

function privateIpv4(host: string) {
  const parts = host.split('.').map(Number); if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
