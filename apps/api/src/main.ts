import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';
import { CorrelationMiddleware } from './common/correlation.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // 全鏈 X-Correlation-ID
  app.use(new CorrelationMiddleware().use);

  // /api/v1 前綴與版本化
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 輸入驗證（白名單防 mass assignment，§8 安全）
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 統一錯誤 envelope
  app.useGlobalFilters(new HttpErrorFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`HEEC EMP API listening on :${port} (/api/v1)`);
}

void bootstrap();
