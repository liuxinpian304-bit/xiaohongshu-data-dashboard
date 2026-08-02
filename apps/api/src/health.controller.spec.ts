import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok', () => {
    expect(new HealthController().getHealth()).toEqual({ status: 'ok' });
  });
});
