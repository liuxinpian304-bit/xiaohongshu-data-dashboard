import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  it('fails closed and accepts only the configured admin token', () => {
    const guard = new AdminGuard('admin-secret');
    expect(guard.canActivate(context(undefined))).toBe(false);
    expect(guard.canActivate(context('admin-'))).toBe(false);
    expect(guard.canActivate(context('admin-secreu'))).toBe(false);
    expect(guard.canActivate(context('admin-secret'))).toBe(true);
    expect(new AdminGuard(undefined).canActivate(context('admin-secret'))).toBe(false);
  });
});

function context(token: string | undefined) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-admin-token': token } }) }) } as ExecutionContext;
}
