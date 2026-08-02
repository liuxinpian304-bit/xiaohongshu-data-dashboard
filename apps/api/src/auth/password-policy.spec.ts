import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { validateAdminPasswordHash } from './password-policy';

describe('admin password policy', () => {
  it('accepts Argon2id with minimum production parameters', async () => {
    const hash = await argon2.hash('password', { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    expect(() => validateAdminPasswordHash(hash)).not.toThrow();
  });
  it('rejects Argon2i and Argon2d hashes', async () => {
    const argon2i = await argon2.hash('password', { type: argon2.argon2i });
    const argon2d = await argon2.hash('password', { type: argon2.argon2d });
    expect(() => validateAdminPasswordHash(argon2i)).toThrow('Argon2id');
    expect(() => validateAdminPasswordHash(argon2d)).toThrow('Argon2id');
  });
  it('rejects weak Argon2id parameters', async () => {
    const weak = await argon2.hash('password', { type: argon2.argon2id, memoryCost: 8192, timeCost: 1 });
    expect(() => validateAdminPasswordHash(weak)).toThrow('parameters');
  });
});
