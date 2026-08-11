import { Module } from '@nestjs/common';

import { DouyinLocalController } from './douyin-local.controller';
import { DouyinLocalService } from './douyin-local.service';

@Module({ controllers: [DouyinLocalController], providers: [DouyinLocalService], exports: [DouyinLocalService] })
export class DouyinLocalModule {}
