import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

type Request = { method: string; cookies?: Record<string, string>; headers: Record<string, string | undefined> };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.admin_session;
    if (!token) throw new UnauthorizedException();
    const session = await this.auth.session(token);
    if (!session) throw new UnauthorizedException();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = request.headers['x-csrf-token'];
      if (!csrf || !this.auth.csrfMatches(session.csrfHash, csrf)) throw new ForbiddenException('invalid CSRF token');
      const fetchSite = request.headers['sec-fetch-site'];
      if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) throw new ForbiddenException('cross-site request rejected');
      const origin = request.headers.origin;
      if (origin) {
        const allowed = process.env.APP_ORIGIN ?? 'http://127.0.0.1';
        if (origin !== allowed) throw new ForbiddenException('origin rejected');
      }
    }
    return true;
  }
}
