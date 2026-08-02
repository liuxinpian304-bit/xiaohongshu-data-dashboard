import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

describe('dashboard API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash('dashboard password', { type: argon2.argon2id });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  });
});
