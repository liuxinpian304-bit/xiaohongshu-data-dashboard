import { Module } from '@nestjs/common';
import { LocalCollectorModule } from '../local-collector/local-collector.module';
import { SettingsController } from './settings.controller';
import { settingsDatabaseProvider, SettingsService } from './settings.service';

@Module({ imports: [LocalCollectorModule], controllers: [SettingsController], providers: [settingsDatabaseProvider, SettingsService] })
export class SettingsModule {}
