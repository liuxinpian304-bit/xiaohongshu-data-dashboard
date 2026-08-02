import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

import { SafeErrorFilter } from './common/error.filter';

export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  app.useGlobalFilters(new SafeErrorFilter());
  const config = new DocumentBuilder().setTitle('Xiaohongshu Dashboard API').setVersion('1.0').addCookieAuth('admin_session').build();
  const document = SwaggerModule.createDocument(app, config, { operationIdFactory: (controller, method) => `${controller}_${method}` });
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.API_PORT ?? 3001);
}

void bootstrap();
