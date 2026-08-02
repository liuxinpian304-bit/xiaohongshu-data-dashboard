import { Body, Controller, ForbiddenException, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { object, stringField } from '../common/validation';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post('login')
  async login(@Body() input: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const origin = request.headers.origin;
    if (origin && origin !== (process.env.APP_ORIGIN ?? 'http://127.0.0.1')) throw new ForbiddenException('origin rejected');
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite && !['same-origin', 'none'].includes(String(fetchSite))) throw new ForbiddenException('cross-site request rejected');
    const body = object(input); const password = stringField(body, 'password', { max: 1024 });
    if (!password) throw new UnauthorizedException();
    const result = await this.auth.login(password, request.ip ?? 'unknown');
    response.cookie('admin_session', result.token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: result.maxAge });
    return { csrfToken: result.csrfToken, expiresIn: result.maxAge / 1000 };
  }
  @Post('logout') @UseGuards(AuthGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies.admin_session);
    response.clearCookie('admin_session', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
    return { ok: true };
  }
}
