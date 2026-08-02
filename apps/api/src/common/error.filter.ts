import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) this.logger.error(error instanceof Error ? error.message : 'Unhandled request error');
    const detail = error instanceof HttpException ? error.getResponse() : undefined;
    const rawMessage = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail ? (detail as { message: unknown }).message : 'Internal server error';
    const message = Array.isArray(rawMessage) ? rawMessage.map(String).join('; ') : typeof rawMessage === 'string' ? rawMessage : 'Internal server error';
    response.status(status).json({ statusCode: status, message });
  }
}
