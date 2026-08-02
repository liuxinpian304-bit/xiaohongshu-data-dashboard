export function trustProxySetting(env: Record<string, string | undefined>): false | number | string[] {
  const hops = env.TRUST_PROXY_HOPS; const cidrs = env.TRUST_PROXY_CIDRS;
  if (hops && cidrs) throw new Error('configure only one trust proxy mode');
  if (hops) { if (!/^\d+$/.test(hops) || Number(hops) > 10) throw new Error('invalid TRUST_PROXY_HOPS'); return Number(hops); }
  if (cidrs) { const entries = cidrs.split(',').map((x) => x.trim()).filter(Boolean); if (!entries.length || entries.some((x) => x === '*' || !/^[0-9a-f:.]+(?:\/\d{1,3})?$/i.test(x))) throw new Error('invalid TRUST_PROXY_CIDRS'); return entries; }
  return false;
}
export function normalizeClientIp(ip: string) { const value = ip.trim().toLowerCase(); return value.startsWith('::ffff:') ? value.slice(7) : value; }
