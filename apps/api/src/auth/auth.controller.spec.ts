import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

describe('AuthController configured origins', () => {
  it('issues a CSRF token for an allowed LAN origin', () => {
    const previous = process.env.APP_ORIGINS;
    process.env.APP_ORIGINS = 'http://127.0.0.1:3000,http://192.168.0.7:3000';
    try {
      const controller = new AuthController({} as AuthService);
      const response = { cookie: vi.fn() } as unknown as Response;
      const result = controller.csrf({ headers: { origin: 'http://192.168.0.7:3000', 'sec-fetch-site': 'same-origin' } } as Request, response);
      expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(response.cookie).toHaveBeenCalledOnce();
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGINS; else process.env.APP_ORIGINS = previous;
    }
  });
});
