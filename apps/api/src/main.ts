import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, getSchemaPath, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { pathToFileURL } from 'node:url';

import { AppModule } from './app.module';

import { SafeErrorFilter } from './common/error.filter';
import { validateAdminPasswordHash } from './auth/password-policy';
import { AccountDeletionDto, AccountDto, AccountStateDto, AuthCsrfResponseDto, AuthLoginResponseDto, AuthorizeAccountDto, BackgroundExportDto, CommentDto, ConnectorCapabilityDto, CreateJobDto, DashboardResponseDto, DeleteAccountDto, ErrorDto, LoginDto, MissingReportFieldDto, NoteDto, NotificationDto, OkResponseDto, PageInfoDto, PushSubscriptionRequestDto, PushSubscriptionResponseDto, ReportDto, ReportMetricDto, ReauthorizeAccountDto, SyncJobDto } from './common/api.dto';
import { trustProxySetting } from './auth/proxy-config';

export function configureApp(app: INestApplication) {
  validateAdminPasswordHash(process.env.ADMIN_PASSWORD_HASH);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxySetting(process.env));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
  app.useGlobalFilters(new SafeErrorFilter());
  const config = new DocumentBuilder().setTitle('Xiaohongshu Dashboard API').setVersion('1.0').addCookieAuth('admin_session').build();
  const models = [LoginDto, AuthorizeAccountDto, ReauthorizeAccountDto, DeleteAccountDto, CreateJobDto, PushSubscriptionRequestDto, ErrorDto, PageInfoDto, ConnectorCapabilityDto, AccountDto, SyncJobDto, NoteDto, CommentDto, MissingReportFieldDto, ReportMetricDto, ReportDto, NotificationDto, DashboardResponseDto, AuthCsrfResponseDto, AuthLoginResponseDto, OkResponseDto, AccountStateDto, AccountDeletionDto, PushSubscriptionResponseDto, BackgroundExportDto];
  const document = SwaggerModule.createDocument(app, config, { operationIdFactory: (controller, method) => `${controller}_${method}`, extraModels: models });
  for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item ?? {})) {
    if (!operation || !['get', 'post', 'patch', 'delete'].includes(method)) continue;
    if (!path.startsWith('/auth/')) operation.security = [{ admin_session: [] }];
    operation.responses ??= {};
    operation.responses['400'] = { description: 'Invalid request', content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorDto) } } } };
    operation.responses['401'] = { description: 'Authentication required', content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorDto) } } } };
    operation.responses['403'] = { description: 'CSRF or origin rejected', content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorDto) } } } };
    if (['post', 'patch', 'delete'].includes(method)) operation.parameters = [...(operation.parameters ?? []), { name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } }];
  }
  const addParameters = (path: string, names: Array<[string, string, boolean, string?, string[]?]>) => { const item = document.paths[path]; if (!item) return; for (const operation of Object.values(item)) if (operation && 'responses' in operation) operation.parameters = [...(operation.parameters ?? []), ...names.map(([name, location, required, format, values]) => ({ name, in: location, required, schema: { type: name === 'limit' ? 'integer' : 'string', ...(format ? { format } : {}), ...(values ? { enum: values } : {}) } }))]; };
  for (const path of Object.keys(document.paths).filter((value) => value.includes('{id}'))) addParameters(path, [['id', 'path', true, 'uuid']]);
  for (const path of ['/accounts', '/accounts/authorized-official', '/jobs', '/notes', '/comments', '/reports', '/notifications']) addParameters(path, [['cursor', 'query', false, 'uuid'], ['limit', 'query', false]]);
  for (const path of ['/notes', '/comments', '/comments/export.csv', '/reports']) addParameters(path, [['accountId', 'query', false, 'uuid']]);
  for (const path of ['/comments', '/comments/export.csv']) addParameters(path, [['noteId', 'query', false, 'uuid'], ['from', 'query', false, 'date-time'], ['to', 'query', false, 'date-time']]);
  for (const path of ['/comments', '/comments/export.csv']) { const operation = document.paths[path]?.get; if (operation) operation.parameters = [...(operation.parameters ?? []), { name: 'accountIds', in: 'query', required: false, schema: { type: 'array', items: { type: 'string', format: 'uuid' } } }]; }
  addParameters('/dashboard', [['period', 'query', false, undefined, ['daily', 'weekly', 'monthly']], ['accountId', 'query', false, 'uuid'], ['source', 'query', false, undefined, ['official']]]);
  const body = (schema: string) => ({ required: true, content: { 'application/json': { schema: { $ref: schema } } } });
  const success = (schema: string, description = 'Success') => ({ description, content: { 'application/json': { schema: { $ref: schema } } } });
  const page = (item: string) => ({ description: 'Cursor page', content: { 'application/json': { schema: { type: 'object', required: ['items', 'pageInfo'], properties: { items: { type: 'array', items: { $ref: item } }, pageInfo: { $ref: getSchemaPath(PageInfoDto) } } } } } });
  for (const [path, model] of [['/accounts', AccountDto], ['/jobs', SyncJobDto], ['/notes', NoteDto], ['/comments', CommentDto], ['/reports', ReportDto]] as const) document.paths[path]!.get!.responses['200'] = page(getSchemaPath(model));
  document.paths['/accounts/authorized-official']!.get!.responses['200'] = page(getSchemaPath(AccountDto));
  document.paths['/dashboard']!.get!.responses['200'] = success(getSchemaPath(DashboardResponseDto));
  document.paths['/auth/csrf']!.get!.responses['200'] = success(getSchemaPath(AuthCsrfResponseDto));
  document.paths['/auth/login']!.post!.responses['201'] = success(getSchemaPath(AuthLoginResponseDto));
  document.paths['/auth/logout']!.post!.responses['201'] = success(getSchemaPath(OkResponseDto));
  document.paths['/auth/login']!.post!.requestBody = body(getSchemaPath(LoginDto));
  document.paths['/accounts/authorize']!.post!.requestBody = body(getSchemaPath(AuthorizeAccountDto));
  document.paths['/accounts/{id}/reauthorize']!.post!.requestBody = body(getSchemaPath(ReauthorizeAccountDto));
  document.paths['/accounts/{id}']!.delete!.requestBody = { ...body(getSchemaPath(DeleteAccountDto)), required: false };
  document.paths['/jobs']!.post!.requestBody = body(getSchemaPath(CreateJobDto));
  document.paths['/accounts/authorize']!.post!.responses['201'] = success(getSchemaPath(AccountDto));
  document.paths['/accounts/{id}/reauthorize']!.post!.responses['201'] = success(getSchemaPath(AccountDto));
  document.paths['/accounts/{id}/deactivate']!.patch!.responses['200'] = success(getSchemaPath(AccountStateDto));
  document.paths['/accounts/{id}']!.delete!.responses['200'] = success(getSchemaPath(AccountDeletionDto));
  document.paths['/jobs']!.post!.responses['202'] = success(getSchemaPath(SyncJobDto), 'Synchronization accepted');
  document.paths['/jobs/{id}/cancel']!.post!.responses['201'] = success(getSchemaPath(SyncJobDto));
  document.paths['/notifications']!.get!.responses['200'] = page(getSchemaPath(NotificationDto));
  document.paths['/notifications/{id}/read']!.patch!.responses['200'] = success(getSchemaPath(NotificationDto));
  document.paths['/notifications/push-subscriptions']!.post!.requestBody = body(getSchemaPath(PushSubscriptionRequestDto));
  document.paths['/notifications/push-subscriptions']!.post!.responses['201'] = success(getSchemaPath(PushSubscriptionResponseDto));
  document.paths['/comments/export.csv']!.get!.responses['200'] = { description: 'Streaming CSV export', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } };
  document.paths['/comments/export.csv']!.get!.responses['202'] = success(getSchemaPath(BackgroundExportDto), 'Background export accepted');
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.API_PORT ?? 3001);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void bootstrap();
