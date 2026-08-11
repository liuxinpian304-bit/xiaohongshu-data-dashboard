import { describe, expect, it } from 'vitest';

import { validateEndpoint } from './client';

describe('validateEndpoint', () => {
  it('accepts only the configured local CDP endpoint', () => {
    expect(validateEndpoint('http://127.0.0.1:43128')).toBe('http://127.0.0.1:43128');
  });

  it.each([
    'http://192.168.0.8:43128',
    'http://localhost:43128',
    'https://127.0.0.1:43128',
    'http://127.0.0.1:43129',
    'http://127.0.0.1:43128/?token=secret',
  ])('rejects an unsafe endpoint: %s', (endpoint) => {
    expect(() => validateEndpoint(endpoint)).toThrow('xiaohuohua_loopback_required');
  });
});
