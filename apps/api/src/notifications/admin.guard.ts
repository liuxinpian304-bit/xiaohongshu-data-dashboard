import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export const ADMIN_API_TOKEN = Symbol('ADMIN_API_TOKEN');

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Optional() @Inject(ADMIN_API_TOKEN) private readonly adminToken?: string) {}
  canActivate(context: ExecutionContext) {
    if (!this.adminToken) return false;
    const token = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>().headers?.['x-admin-token'];
    if (typeof token !== 'string') return false;
    const actual = Buffer.from(token, 'utf8');
    const expected = Buffer.from(this.adminToken, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
