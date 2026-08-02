import { prisma } from '@xhs/database';
import argon2 from 'argon2';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';

describe('atomic login throttling', () => {
  beforeEach(async () => { await prisma.loginAttempt.deleteMany(); process.env.ADMIN_PASSWORD_HASH = await argon2.hash('right', { type: argon2.argon2id }); });
  it('serializes parallel guesses so the sixth attempt is throttled', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => new AuthService().login('wrong', '203.0.113.9')));
    const messages = results.map((result) => result.status === 'rejected' ? result.reason.message : 'success');
    expect(messages.filter((message) => message === 'too many login attempts'), JSON.stringify(messages)).toHaveLength(1);
    expect(await prisma.loginAttempt.count({ where: { fingerprint: 'admin:203.0.113.9' } })).toBe(5);
  });
});
