import { describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationsController } from './notifications.controller';

describe('NotificationsModule boot', () => {
  it('starts with resolvable controller, store provider, and session guard', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    expect(app.get(NotificationsController)).toBeInstanceOf(NotificationsController);
    expect(app.get(AuthGuard)).toBeInstanceOf(AuthGuard);
    await app.close();
  });
});
