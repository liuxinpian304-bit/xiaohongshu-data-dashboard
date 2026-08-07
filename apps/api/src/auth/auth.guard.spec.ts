import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import type { AuthService } from './auth.service';

describe('AuthGuard configured origins', () => {
  it('accepts an authenticated write from an allowed LAN origin', async () => {
    const previous = process.env.APP_ORIGINS;
    process.env.APP_ORIGINS = 'http://127.0.0.1:3000,http://192.168.0.7:3000';
    try {
      const auth = { session: async () => ({ csrfHash: 'hash' }), csrfMatches: () => true } as unknown as AuthService;
      const guard = new AuthGuard(auth);
      const request = { method: 'POST', cookies: { admin_session: 'session' }, headers: { 'x-csrf-token': 'csrf', 'sec-fetch-site': 'same-origin', origin: 'http://192.168.0.7:3000' } };
      const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).resolves.toBe(true);
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGINS; else process.env.APP_ORIGINS = previous;
    }
  });
});
