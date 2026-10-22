import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { RequestLogMiddleware } from './common/request-log.middleware';
import { OrgContextMiddleware } from './common/org-context.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // 請求範圍組織脈絡（供執行期 RLS 強制）——須在路由/守衛之前
  app.use(new OrgContextMiddleware().use);

  // 全鏈 X-Correlation-ID
  app.use(new CorrelationMiddleware().use);

  // 結構化存取日誌 + 指標記錄
  app.use(new RequestLogMiddleware().use);

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

  // 正式環境身分設定健全性警告（不阻擋啟動，但明確提示風險）
  if (process.env.NODE_ENV === 'production') {
    const oidc = Boolean(process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE);
    if (process.env.AUTH_DEV_HEADERS === '1') {
      console.warn('[auth] WARNING: AUTH_DEV_HEADERS=1 in production — 開發身分替身標頭已啟用，非正式登入方案，請確認這是刻意設定。');
    } else if (!oidc) {
      console.warn('[auth] WARNING: production 無 OIDC_ISSUER/OIDC_AUDIENCE 且未啟用開發標頭 — 所有受保護端點將因缺少身分而拒絕。');
    }
    if ((process.env.STORAGE_DRIVER ?? 'local') !== 's3') {
      console.warn('[storage] WARNING: production 使用本機儲存驅動；正式部署建議 STORAGE_DRIVER=s3（私有雲端物件儲存）。');
    }
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
   
  console.log(`HEEC EMP API listening on :${port} (/api/v1)`);
}

void bootstrap();
