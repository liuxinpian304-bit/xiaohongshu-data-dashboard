import { describe, expect, it } from 'vitest';
import { CredentialCipher } from './credential-cipher';

describe('CredentialCipher', () => {
  it('round-trips credentials with account and credential identity bound as AAD', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString('base64'));
    const encrypted = cipher.encrypt('secret', 'account-1', 'credential-1');
    expect(cipher.decrypt(encrypted, 'account-1', 'credential-1')).toBe('secret');
    expect(() => cipher.decrypt(encrypted, 'account-2', 'credential-1')).toThrow();
  });

  it('uses a unique random IV for every encryption', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString('base64'));
    expect(cipher.encrypt('secret', 'a', 'c')).not.toBe(cipher.encrypt('secret', 'a', 'c'));
  });

  it.each(['v2.a.b.c', 'v1.a.b', 'v1.a.b.c.extra', 'v1...c', 'v1.YQ.YQ.YQ'])('rejects malformed serialized payload %s deterministically', (payload) => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString('base64'));
    expect(() => cipher.decrypt(payload, 'a', 'c')).toThrow('invalid encrypted credential');
  });
});
