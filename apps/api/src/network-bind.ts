type Environment = Record<string, string | undefined>;

export function apiListenHost(environment: Environment = process.env) {
  const host = environment.API_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('api_loopback_required');
  return host;
}
