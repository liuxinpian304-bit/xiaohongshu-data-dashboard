import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { prisma } from '@xhs/database';

describe('admin authentication', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash('correct horse', { type: argon2.argon2id });
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app.close());

  async function login(agent = request.agent(app.getHttpServer())) {
    const pre = await agent.get('/auth/csrf').set('Sec-Fetch-Site', 'same-origin').set('Origin', 'http://127.0.0.1').expect(200);
    const response = await agent.post('/auth/login').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'correct horse' });
    expect(response.status).toBe(201);
    return { agent, response, preToken: pre.body.csrfToken as string };
  }

  it('issues an opaque HttpOnly session and rotates the pre-login CSRF token', async () => {
    const { response, preToken } = await login();
    expect(response.status).toBe(201);
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Strict');
    expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(response.body.csrfToken).not.toBe(preToken);
  });

  it('rejects an invalid password without exposing details', async () => {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
    const response = await agent.post('/auth/login').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'wrong' }).expect(401);
    expect(response.body).not.toHaveProperty('stack');
  });

  it('rejects cookie-authenticated state changes without the bound CSRF token', async () => {
    const { agent } = await login();
    await agent.post('/auth/logout').expect(403);
  });

  it.each([
    ['missing origin', undefined, 'same-origin'],
    ['wrong origin', 'https://evil.example', 'same-origin'],
    ['missing fetch metadata', 'http://127.0.0.1', undefined],
    ['cross-site fetch', 'http://127.0.0.1', 'cross-site'],
  ])('fails login closed for %s', async (_name, origin, fetchSite) => {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
    let call = agent.post('/auth/login').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'correct horse' });
    if (origin) call = call.set('Origin', origin);
    if (fetchSite) call = call.set('Sec-Fetch-Site', fetchSite);
    await call.expect(403);
  });

  it('revokes logout session and rejects reuse of the old cookie', async () => {
    const { agent, response } = await login();
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    await agent.post('/auth/logout').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', response.body.csrfToken).expect(201);
    await request(app.getHttpServer()).get('/accounts').set('Cookie', cookie).expect(401);
  });

  it('rejects an expired session', async () => {
    const { response } = await login();
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    await prisma.adminSession.updateMany({ data: { expiresAt: new Date(0) } });
    await request(app.getHttpServer()).get('/accounts').set('Cookie', cookie).expect(401);
  });

  it.each(['/comments?from=not-a-date', '/comments?from=2026-08-02T12:00:00Z&to=2026-08-01T12:00:00Z'])('rejects invalid date query %s', async (path) => {
    const { agent } = await login();
    await agent.get(path).expect(400);
  });

  it('marks pre-session and admin cookies Secure in production', async () => {
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    try {
      const pre = await request(app.getHttpServer()).get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
      expect(pre.headers['set-cookie'][0]).toContain('Secure');
      const cookie = pre.headers['set-cookie'][0].split(';')[0];
      const loginResponse = await request(app.getHttpServer()).post('/auth/login').set('Cookie', cookie).set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'correct horse' }).expect(201);
      expect(loginResponse.headers['set-cookie'][0]).toContain('Secure');
    } finally { process.env.NODE_ENV = previous; }
  });

  it('rotates an existing session at login and invalidates the previous cookie', async () => {
    const first = await login(); const oldCookie = first.response.headers['set-cookie'][0].split(';')[0];
    await login(first.agent);
    await request(app.getHttpServer()).get('/accounts').set('Cookie', oldCookie).expect(401);
  });

  it('rejects unknown login fields through executable DTO validation', async () => {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/auth/csrf').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').expect(200);
    await agent.post('/auth/login').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', pre.body.csrfToken).send({ password: 'correct horse', admin: true }).expect(400);
  });

  it('validates notification account and path identifiers as UUIDs', async () => {
    const { agent, response } = await login();
    await agent.get('/notifications?accountId=not-a-uuid').expect(400);
    await agent.patch('/notifications/not-a-uuid/read').set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin').set('X-CSRF-Token', response.body.csrfToken).expect(400);
  });

  it('rejects malformed accountIds arrays instead of silently ignoring them', async () => {
    const { agent } = await login();
    await agent.get('/comments').query({ accountIds: ['not-a-uuid'] }).expect(400);
  });
});
