import { Controller, Delete, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard';
import { DouyinLocalService } from './douyin-local.service';

@Controller('douyin-local/sessions')
@UseGuards(AuthGuard)
export class DouyinLocalController {
  constructor(@Inject(DouyinLocalService) private readonly service: DouyinLocalService) {}
  @Get() list() { return this.service.list(); }
  @Post() create() { return this.service.create(); }
  @Get(':sessionId') status(@Param('sessionId') sessionId: string) { return this.service.status(sessionId); }
  @Post(':sessionId/refresh') refresh(@Param('sessionId') sessionId: string) { return this.service.refresh(sessionId); }
  @Post(':sessionId/collection/start') startCollection(@Param('sessionId') sessionId: string) { return this.service.startCollection(sessionId); }
  @Get(':sessionId/collection/status') collectionStatus(@Param('sessionId') sessionId: string) { return this.service.collectionStatus(sessionId); }
  @Delete(':sessionId') close(@Param('sessionId') sessionId: string) { return this.service.close(sessionId); }
  @Get(':sessionId/qr') async qr(@Param('sessionId') sessionId: string, @Res() response: Response) {
    const qr = await this.service.qr(sessionId);
    response.setHeader('content-type', 'image/png');
    response.setHeader('content-length', qr.bytes.byteLength);
    response.setHeader('cache-control', 'private, no-store, max-age=0');
    response.setHeader('x-content-type-options', 'nosniff');
    if (qr.expires) response.setHeader('expires', qr.expires);
    response.end(qr.bytes);
  }
}
