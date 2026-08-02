import { describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AdminGuard } from './admin.guard';
import { NotificationsController } from './notifications.controller';

describe('NotificationsModule boot', () => {
  it('starts with resolvable controller, store provider, and admin guard', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    expect(app.get(NotificationsController)).toBeInstanceOf(NotificationsController);
    expect(app.get(AdminGuard)).toBeInstanceOf(AdminGuard);
    await app.close();
  });
});
