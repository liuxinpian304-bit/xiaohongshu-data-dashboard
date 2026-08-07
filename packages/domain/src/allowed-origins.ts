type Environment = Record<string, string | undefined>;

const DEFAULT_ORIGIN = 'http://127.0.0.1:3000';

function normalizeOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('invalid application origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid application origin');
  return url.origin;
}

export function allowedOrigins(environment: Environment = process.env) {
  const configured = environment.APP_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const values = configured.length ? configured : environment.APP_ORIGIN ? [environment.APP_ORIGIN] : [DEFAULT_ORIGIN];
  return new Set(values.map(normalizeOrigin));
}

export function requireAllowedOrigin(origin: string | undefined, environment: Environment = process.env) {
  if (!origin || !allowedOrigins(environment).has(origin)) throw new Error('origin rejected');
  return origin;
}

export function primaryAllowedOrigin(environment: Environment = process.env) {
  return allowedOrigins(environment).values().next().value ?? DEFAULT_ORIGIN;
}
