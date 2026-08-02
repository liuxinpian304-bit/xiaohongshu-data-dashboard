import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TTL_MS = 30 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  async login(password: string, fingerprint: string) {
    const since = new Date(Date.now() - 15 * 60_000);
    if (await prisma.loginAttempt.count({ where: { fingerprint, attemptedAt: { gte: since } } }) >= 5) throw new HttpException('too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
    const configured = process.env.ADMIN_PASSWORD_HASH;
    const valid = configured ? await argon2.verify(configured, password).catch(() => false) : false;
    if (!valid) {
      await prisma.loginAttempt.create({ data: { fingerprint } });
      throw new UnauthorizedException('invalid credentials');
    }
    await prisma.loginAttempt.deleteMany({ where: { fingerprint } });
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    await prisma.adminSession.create({ data: { tokenHash: hash(token), csrfHash: hash(csrfToken), expiresAt: new Date(Date.now() + TTL_MS) } });
    return { token, csrfToken, maxAge: TTL_MS };
  }
  async session(token: string) {
    return prisma.adminSession.findFirst({ where: { tokenHash: hash(token), revokedAt: null, expiresAt: { gt: new Date() } } });
  }
  csrfMatches(expectedHash: string, token: string) {
    const actual = Buffer.from(hash(token)); const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  async logout(token: string) { await prisma.adminSession.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: new Date() } }); }
}
