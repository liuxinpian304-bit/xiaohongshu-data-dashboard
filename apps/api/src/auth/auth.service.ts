import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TTL_MS = 30 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  async login(password: string, fingerprint: string, priorSessionToken?: string) {
    const clientKey = `admin:${fingerprint.trim().toLowerCase()}`; const globalKey = 'global:admin';
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${globalKey}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${clientKey}))::text`;
      const since = new Date(Date.now() - 15 * 60_000);
      const [clientAttempts, globalAttempts] = await Promise.all([
        tx.loginAttempt.count({ where: { fingerprint: clientKey, attemptedAt: { gte: since } } }),
        tx.loginAttempt.count({ where: { fingerprint: globalKey, attemptedAt: { gte: since } } }),
      ]);
      if (clientAttempts >= 5 || globalAttempts >= 100) return { outcome: 'throttled' as const };
      const configured = process.env.ADMIN_PASSWORD_HASH;
      const valid = configured ? await argon2.verify(configured, password).catch(() => false) : false;
      if (!valid) {
        await tx.loginAttempt.createMany({ data: [{ fingerprint: clientKey }, { fingerprint: globalKey }] });
        return { outcome: 'invalid' as const };
      }
      await tx.loginAttempt.deleteMany({ where: { fingerprint: clientKey } });
      const token = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(32).toString('base64url');
      if (priorSessionToken) await tx.adminSession.updateMany({ where: { tokenHash: hash(priorSessionToken), revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.adminSession.create({ data: { tokenHash: hash(token), csrfHash: hash(csrfToken), expiresAt: new Date(Date.now() + TTL_MS) } });
      return { outcome: 'success' as const, token, csrfToken, maxAge: TTL_MS };
    });
    if (result.outcome === 'throttled') throw new HttpException('too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
    if (result.outcome === 'invalid') throw new UnauthorizedException('invalid credentials');
    return result;
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
