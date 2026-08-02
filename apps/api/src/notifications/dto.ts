import { PushEndpointPolicy } from './push-endpoint.policy';

export interface PushSubscriptionDto {
  accountId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function parsePushSubscription(input: unknown, policy = new PushEndpointPolicy()): PushSubscriptionDto {
  if (!input || typeof input !== 'object') throw new Error('push subscription must be an object');
  const candidate = input as { accountId?: unknown; endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof candidate.accountId !== 'string' || candidate.accountId.length === 0) throw new Error('accountId is required');
  if (typeof candidate.endpoint !== 'string' || candidate.endpoint.length > 4096) throw new Error('endpoint must be an HTTPS URL');
  policy.assertAllowed(candidate.endpoint);
  if (!candidate.keys || typeof candidate.keys.p256dh !== 'string' || candidate.keys.p256dh.length === 0 || candidate.keys.p256dh.length > 4096) throw new Error('p256dh is required');
  if (typeof candidate.keys.auth !== 'string' || candidate.keys.auth.length === 0 || candidate.keys.auth.length > 4096) throw new Error('auth is required');
  return { accountId: candidate.accountId, endpoint: candidate.endpoint, keys: { p256dh: candidate.keys.p256dh, auth: candidate.keys.auth } };
}
