import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

describe('admin authentication', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash('correct horse', { type: argon2.argon2id });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app.close());

  it('issues an opaque HttpOnly session and CSRF token for a valid password', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login')
      .set('Origin', 'http://127.0.0.1').send({ password: 'correct horse' }).expect(201);
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Strict');
    expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it('rejects an invalid password without exposing details', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login')
      .set('Origin', 'http://127.0.0.1').send({ password: 'wrong' }).expect(401);
    expect(response.body).not.toHaveProperty('stack');
  });

  it('rejects cookie-authenticated state changes without the bound CSRF token', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ password: 'correct horse' }).expect(201);
    await agent.post('/auth/logout').expect(403);
  });
});
