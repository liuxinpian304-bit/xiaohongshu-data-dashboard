import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { prisma } from '@xhs/database';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushEndpointPolicy } from '@xhs/domain';

describe('dashboard API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash('dashboard password', { type: argon2.argon2id });
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    (module.get(NotificationsService) as unknown as { endpointPolicy: PushEndpointPolicy }).endpointPolicy = new PushEndpointPolicy(['push.example.test'], async () => ['8.8.8.8']);
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app.close());

  it('rejects protected resources without an admin session', async () => {
    await request(app.getHttpServer()).get('/accounts').expect(401);
    await request(app.getHttpServer()).get('/dashboard?period=daily').expect(401);
  });

  it('returns dashboard data with explicit availability to an authenticated admin', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await agent.get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
    await agent.post('/auth/login').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', csrf.body.csrfToken).send({ password: 'dashboard password' }).expect(201);
    const response = await agent.get('/dashboard?period=daily').expect(200);
    expect(response.body.cards[0]).toMatchObject({ key: expect.any(String), availability: expect.stringMatching(/available|zero|not_synced|awaiting_authorization|not_provided/) });
  });

  it('publishes OpenAPI JSON with unique operation ids', async () => {
    const response = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);
    const ids = Object.values(response.body.paths as Record<string, Record<string, { operationId?: string }>>).flatMap((path) => Object.values(path).map((operation) => operation.operationId).filter(Boolean));
    expect(new Set(ids).size).toBe(ids.length);
    expect(response.body.paths['/accounts'].get.responses['200'].content['application/json'].schema).toBeTruthy();
    expect(response.body.paths['/jobs'].post.responses['202']).toBeTruthy();
    expect(response.body.paths['/comments/export.csv'].get.responses['200'].content['text/csv']).toBeTruthy();
    expect(response.body.paths['/auth/login'].post.requestBody).toBeTruthy();
    expect(response.body.paths['/auth/login'].post.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'X-CSRF-Token', in: 'header' })]));
    for (const [path, method] of [
      ['/dashboard', 'get'], ['/auth/csrf', 'get'], ['/auth/login', 'post'], ['/auth/logout', 'post'],
      ['/accounts/authorize', 'post'], ['/accounts/{id}/reauthorize', 'post'], ['/accounts/{id}/deactivate', 'patch'], ['/accounts/{id}', 'delete'],
      ['/jobs/{id}/cancel', 'post'], ['/notifications', 'get'], ['/notifications/{id}/read', 'patch'], ['/notifications/push-subscriptions', 'post'],
    ] as const) {
      const success = Object.entries(response.body.paths[path][method].responses).find(([status]) => status.startsWith('2'))?.[1] as { content?: Record<string, { schema?: unknown }> } | undefined;
      expect(success?.content?.['application/json']?.schema, `${method.toUpperCase()} ${path}`).toBeTruthy();
    }
    for (const [path, model] of [['/accounts', 'AccountDto'], ['/jobs', 'SyncJobDto'], ['/notes', 'NoteDto'], ['/comments', 'CommentDto'], ['/reports', 'ReportDto']] as const) {
      expect(response.body.paths[path].get.responses['200'].content['application/json'].schema.properties.items.items.$ref).toBe(`#/components/schemas/${model}`);
    }
    expect(response.body.paths['/comments/export.csv'].get.responses['202'].content['application/json'].schema.$ref).toBe('#/components/schemas/BackgroundExportDto');
  });

  it('uses precise OpenAPI primitives, enums, formats, and nullable contracts', async () => {
    const spec = (await request(app.getHttpServer()).get('/docs/openapi.json').expect(200)).body; const schemas = spec.components.schemas;
    expect(schemas.PageInfoDto.properties.nextCursor).toMatchObject({ type: 'string', format: 'uuid', nullable: true });
    expect(schemas.SyncJobDto.properties.status.enum).toEqual(['pending', 'running', 'succeeded', 'failed']);
    expect(schemas.SyncJobDto.properties.currentStage.enum).toContain('export_comments');
    expect(schemas.SyncJobDto.properties.startedAt).toMatchObject({ format: 'date-time', nullable: true });
    expect(schemas.ReportDto.properties.reportType.enum).toEqual(['daily', 'weekly', 'monthly']);
    expect(schemas.ReportDto.properties.status.enum).toEqual(['complete', 'awaiting_data']);
    expect(schemas.ReportDto.properties.missingFields).toMatchObject({ type: 'array', items: { $ref: '#/components/schemas/MissingReportFieldDto' } });
    expect(schemas.ReportDto.properties.missingDates.items).toMatchObject({ type: 'string', format: 'date' });
    expect(schemas.ReportMetricDto.properties.availability.enum).toEqual(['zero', 'not_synced', 'awaiting_authorization', 'not_provided', 'available']);
    expect(schemas.DashboardResponseDto.properties.period.enum).toEqual(['daily', 'weekly', 'monthly']);
    expect(schemas.DashboardResponseDto.properties.periodStart).toMatchObject({ type: 'string', format: 'date-time' });
    expect(schemas.DashboardResponseDto.properties.periodEnd).toMatchObject({ type: 'string', format: 'date-time' });
    expect(schemas.DashboardResponseDto.properties.lastSyncedAt).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
    expect(schemas.DashboardResponseDto.properties.source).toMatchObject({ type: 'string', nullable: true });
    expect(schemas.DashboardResponseDto.properties.trend.items.$ref).toBe('#/components/schemas/DashboardTrendPointDto');
    expect(schemas.DashboardResponseDto.properties.rankedNotes.items.$ref).toBe('#/components/schemas/DashboardRankedNoteDto');
    expect(schemas.NotificationDto.properties.type.enum).toContain('report_rebuilt');
    expect(schemas.NotificationDto.properties.eventId).not.toHaveProperty('format');
    for (const path of ['/accounts', '/jobs', '/notes', '/comments', '/reports', '/notifications']) {
      const limit = spec.paths[path].get.parameters.find((parameter: { name: string }) => parameter.name === 'limit'); expect(limit.schema.type).toBe('integer');
    }
    const period = spec.paths['/dashboard'].get.parameters.find((parameter: { name: string }) => parameter.name === 'period'); expect(period.schema.enum).toEqual(['daily', 'weekly', 'monthly']);
  });

  it('returns mutation bodies matching public schemas without credential material', async () => {
    const agent = request.agent(app.getHttpServer()); const pre = await agent.get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
    const login = await agent.post('/auth/login').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'dashboard password' }).expect(201);
    const mutation = (requestBuilder: request.Test) => requestBuilder.set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', login.body.csrfToken);
    const authorized = await mutation(agent.post('/accounts/authorize')).send({ connectorType: `mutation-${crypto.randomUUID()}`, platformId: crypto.randomUUID(), displayName: 'Mutation', secret: 'credential-one', kind: 'oauth' }).expect(201);
    const reauthorized = await mutation(agent.post(`/accounts/${authorized.body.id}/reauthorize`)).send({ secret: 'credential-two', kind: 'oauth' }).expect(201);
    const pushed = await mutation(agent.post('/notifications/push-subscriptions')).send({ accountId: authorized.body.id, endpoint: 'https://push.example.test/sub', keys: { p256dh: 'public-key', auth: 'auth-secret' } }).expect(201);
    const spec = (await request(app.getHttpServer()).get('/docs/openapi.json')).body;
    for (const body of [authorized.body, reauthorized.body]) { expect(body.capabilities).toEqual([]); expect(Object.keys(body).sort()).toEqual(Object.keys(spec.components.schemas.AccountDto.properties).sort()); }
    expect(pushed.body).toEqual(expect.objectContaining({ accountId: authorized.body.id, endpoint: 'https://push.example.test/sub' }));
    expect(pushed.body).not.toHaveProperty('p256dh'); expect(pushed.body).not.toHaveProperty('auth');
    expect(Object.keys(pushed.body).sort()).toEqual(Object.keys(spec.components.schemas.PushSubscriptionResponseDto.properties).sort());
  });

  it('documents every field emitted by representative resource responses', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'schema-test', platformId: crypto.randomUUID(), displayName: 'Schema', capabilities: { create: { capability: 'comments', enabled: true } } } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: 'schema-test', platformId: crypto.randomUUID(), title: 'Schema note', publishedAt: new Date() } });
    const comment = await prisma.comment.create({ data: { noteId: note.id, connectorType: 'schema-test', platformId: crypto.randomUUID(), content: 'Schema comment', publishedAt: new Date(), source: 'official' } });
    const job = await prisma.syncJob.create({ data: { accountId: account.id } });
    const metricDefinition = await prisma.metricDefinition.create({ data: { key: `schema-${crypto.randomUUID()}`, displayName: 'Schema metric', unit: 'count' } });
    const report = await prisma.report.create({ data: { accountId: account.id, reportType: 'daily', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-02'), metrics: { create: { metricDefinitionId: metricDefinition.id, availability: 'available', value: 1 } } } });
    const notification = await prisma.notification.create({ data: { accountId: account.id, eventId: crypto.randomUUID(), type: 'sync_completed', title: 'done', body: 'done', link: '/jobs' } });
    const agent = request.agent(app.getHttpServer()); const pre = await agent.get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
    await agent.post('/auth/login').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'dashboard password' }).expect(201);
    const spec = (await request(app.getHttpServer()).get('/docs/openapi.json')).body;
    for (const [path, model, expectedId] of [['/accounts', 'AccountDto', account.id], ['/jobs', 'SyncJobDto', job.id], ['/notes', 'NoteDto', note.id], ['/comments', 'CommentDto', comment.id], ['/reports', 'ReportDto', report.id], ['/notifications', 'NotificationDto', notification.id]] as const) {
      const response = await agent.get(path).query({ limit: 200 }).expect(200); const item = response.body.items.find((candidate: { id: string }) => candidate.id === expectedId); const schema = spec.components.schemas[model];
      for (const key of Object.keys(item)) expect(schema.properties, `${model}.${key}`).toHaveProperty(key);
      if (model === 'AccountDto') for (const key of Object.keys(item.capabilities[0])) expect(spec.components.schemas.ConnectorCapabilityDto.properties).toHaveProperty(key);
      if (model === 'ReportDto') for (const key of Object.keys(item.metrics[0])) expect(spec.components.schemas.ReportMetricDto.properties).toHaveProperty(key);
    }
  });
});
