import { Body, Controller, Get, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard';
import { LocalCollectorService } from './local-collector.service';
import { LocalCollectorSyncDto } from '../common/api.dto';
import { dtoPipe } from '../common/dto.pipe';

@Controller('local-collector') @UseGuards(AuthGuard)
export class LocalCollectorController {
  constructor(@Inject(LocalCollectorService) private readonly collector: LocalCollectorService) {}
  @Get('status') status() { return this.collector.action('status'); }
  @Post('start') start() { return this.collector.action('start'); }
  @Post('refresh') refresh() { return this.collector.action('refresh'); }
  @Post('close') close() { return this.collector.action('close'); }
  @Post('sync') sync(@Body(dtoPipe(LocalCollectorSyncDto)) input: LocalCollectorSyncDto) { return this.collector.startSync(input.accountId); }
  @Get('sync-status') syncStatus() { return this.collector.syncStatus(); }
  @Get('qr') async qr(@Res() response: Response) {
    const qr = await this.collector.qr();
    response.setHeader('content-type', 'image/png');
    response.setHeader('content-length', qr.bytes.byteLength);
    response.setHeader('cache-control', 'private, no-store, max-age=0');
    response.setHeader('etag', qr.etag);
    response.setHeader('expires', qr.expires);
    response.setHeader('x-content-type-options', 'nosniff');
    response.end(qr.bytes);
  }
}
