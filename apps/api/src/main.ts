import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, getSchemaPath, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { pathToFileURL } from 'node:url';

import { AppModule } from './app.module';

import { SafeErrorFilter } from './common/error.filter';
import { validateAdminPasswordHash } from './auth/password-policy';
import { AuthorizeAccountDto, CreateJobDto, DeleteAccountDto, ErrorDto, LoginDto, PaginatedResponseDto, ReauthorizeAccountDto } from './common/api.dto';
import { trustProxySetting } from './auth/proxy-config';

export function configureApp(app: INestApplication) {
  validateAdminPasswordHash(process.env.ADMIN_PASSWORD_HASH);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxySetting(process.env));
  app.use(cookieParser());
  app.useGlobalFilters(new SafeErrorFilter());
  const config = new DocumentBuilder().setTitle('Xiaohongshu Dashboard API').setVersion('1.0').addCookieAuth('admin_session').build();
  const models = [LoginDto, AuthorizeAccountDto, ReauthorizeAccountDto, DeleteAccountDto, CreateJobDto, PaginatedResponseDto, ErrorDto];
  const document = SwaggerModule.createDocument(app, config, { operationIdFactory: (controller, method) => `${controller}_${method}`, extraModels: models });
  for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item ?? {})) {
    if (!operation || !['get', 'post', 'patch', 'delete'].includes(method)) continue;
    if (!path.startsWith('/auth/')) operation.security = [{ admin_session: [] }];
    operation.responses ??= {};
    operation.responses['400'] = { description: 'Invalid request', content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorDto) } } } };
    operation.responses['401'] = { description: 'Authentication required', content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorDto) } } } };
    operation.responses['403'] = { description: 'CSRF or origin rejected', content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorDto) } } } };
    if (['post', 'patch', 'delete'].includes(method)) operation.parameters = [...(operation.parameters ?? []), { name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } }];
    if (method === 'get' && ['/accounts', '/jobs', '/notes', '/comments', '/reports'].includes(path)) operation.responses['200'] = { description: 'Cursor page', content: { 'application/json': { schema: { $ref: getSchemaPath(PaginatedResponseDto) } } } };
  }
  const addParameters = (path: string, names: Array<[string, string, boolean, string?]>) => { const item = document.paths[path]; if (!item) return; for (const operation of Object.values(item)) if (operation && 'responses' in operation) operation.parameters = [...(operation.parameters ?? []), ...names.map(([name, location, required, format]) => ({ name, in: location, required, schema: { type: 'string', ...(format ? { format } : {}) } }))]; };
  for (const path of Object.keys(document.paths).filter((value) => value.includes('{id}'))) addParameters(path, [['id', 'path', true, 'uuid']]);
  for (const path of ['/accounts', '/jobs', '/notes', '/comments', '/reports']) addParameters(path, [['cursor', 'query', false], ['limit', 'query', false]]);
  for (const path of ['/notes', '/comments', '/comments/export.csv', '/reports']) addParameters(path, [['accountId', 'query', false, 'uuid']]);
  for (const path of ['/comments', '/comments/export.csv']) addParameters(path, [['noteId', 'query', false, 'uuid'], ['from', 'query', false, 'date-time'], ['to', 'query', false, 'date-time']]);
  addParameters('/dashboard', [['period', 'query', false]]);
  const body = (schema: string) => ({ required: true, content: { 'application/json': { schema: { $ref: schema } } } });
  document.paths['/auth/login']!.post!.requestBody = body(getSchemaPath(LoginDto));
  document.paths['/accounts/authorize']!.post!.requestBody = body(getSchemaPath(AuthorizeAccountDto));
  document.paths['/accounts/{id}/reauthorize']!.post!.requestBody = body(getSchemaPath(ReauthorizeAccountDto));
  document.paths['/accounts/{id}']!.delete!.requestBody = body(getSchemaPath(DeleteAccountDto));
  document.paths['/jobs']!.post!.requestBody = body(getSchemaPath(CreateJobDto));
  document.paths['/jobs']!.post!.responses['202'] = { description: 'Synchronization accepted', content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } } };
  document.paths['/comments/export.csv']!.get!.responses['200'] = { description: 'Streaming CSV export', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } };
  document.paths['/comments/export.csv']!.get!.responses['202'] = { description: 'Background export accepted' };
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.API_PORT ?? 3001);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void bootstrap();
