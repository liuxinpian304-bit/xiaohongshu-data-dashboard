import { Body, Controller, ForbiddenException, Get, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { object, stringField } from '../common/validation';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { LoginDto } from '../common/api.dto';
import { normalizeClientIp } from './proxy-config';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private requireSameOrigin(request: Request) {
    if (request.headers.origin !== (process.env.APP_ORIGIN ?? 'http://127.0.0.1')) throw new ForbiddenException('origin rejected');
    if (request.headers['sec-fetch-site'] !== 'same-origin') throw new ForbiddenException('cross-site request rejected');
  }
  @Get('csrf')
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.requireSameOrigin(request);
    const csrfToken = randomBytes(32).toString('base64url');
    response.cookie('pre_auth_csrf', csrfToken, { httpOnly: false, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/auth', maxAge: 5 * 60_000 });
    return { csrfToken };
  }
  @Post('login')
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.requireSameOrigin(request);
    const header = request.headers['x-csrf-token']; const cookie = request.cookies.pre_auth_csrf;
    const a = Buffer.from(typeof header === 'string' ? header : ''); const b = Buffer.from(typeof cookie === 'string' ? cookie : '');
    if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('invalid CSRF token');
    const body = object(input); const password = stringField(body, 'password', { max: 1024 });
    if (!password) throw new UnauthorizedException();
    const result = await this.auth.login(password, normalizeClientIp(request.ip ?? 'unknown'), request.cookies.admin_session);
    response.cookie('admin_session', result.token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: result.maxAge });
    response.clearCookie('pre_auth_csrf', { sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/auth' });
    return { csrfToken: result.csrfToken, expiresIn: result.maxAge / 1000 };
  }
  @Post('logout') @UseGuards(AuthGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies.admin_session);
    response.clearCookie('admin_session', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
    return { ok: true };
  }
}
