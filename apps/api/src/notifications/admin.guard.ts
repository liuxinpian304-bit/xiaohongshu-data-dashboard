import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';

export const ADMIN_API_TOKEN = Symbol('ADMIN_API_TOKEN');

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Optional() @Inject(ADMIN_API_TOKEN) private readonly adminToken?: string) {}
  canActivate(context: ExecutionContext) {
    if (!this.adminToken) return false;
    const token = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>().headers?.['x-admin-token'];
    return typeof token === 'string' && token === this.adminToken;
  }
}
