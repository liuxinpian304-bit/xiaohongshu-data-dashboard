import { describe, expect, it } from 'vitest';
import { mutationHeaders, validateMutationRequest } from './bff';

describe('mutation BFF boundary', () => {
  it('rejects cross-origin and cross-site mutation requests', () => {
    expect(() => validateMutationRequest(new Request('http://127.0.0.1/api/jobs', { method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } }), 'http://127.0.0.1')).toThrow('origin rejected');
  });
  it('forwards session and csrf only in server-side headers', () => {
    expect(mutationHeaders('session-value', 'csrf-value', 'http://127.0.0.1')).toMatchObject({ cookie: 'admin_session=session-value', 'x-csrf-token': 'csrf-value', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin' });
  });
});
