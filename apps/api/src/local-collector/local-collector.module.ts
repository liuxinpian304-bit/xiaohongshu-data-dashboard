import { Module } from '@nestjs/common';

import { LocalCollectorController } from './local-collector.controller';
import { LocalCollectorService } from './local-collector.service';

@Module({ controllers: [LocalCollectorController], providers: [LocalCollectorService], exports: [LocalCollectorService] })
export class LocalCollectorModule {}
