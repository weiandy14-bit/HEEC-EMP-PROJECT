import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.service';

/**
 * 健康檢查：
 * - /health       既有存活+DB 概況（相容）
 * - /health/live  存活探針（程序在即 200）
 * - /health/ready 就緒探針：DB 為硬相依；另回報儲存驅動與掃描模式。DB 不通回 503。
 */
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async health() {
    const dbOk = await this.db.healthy();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  async ready(@Res() res: Response) {
    const dbOk = await this.db.healthy();
    const storage = (process.env.STORAGE_DRIVER ?? 'local') === 's3' ? 's3' : 'local';
    const scanner =
      process.env.NODE_ENV === 'test' && process.env.EXCHANGE_TEST_SCANNER === '1'
        ? 'bypassed(test)'
        : 'clamd';
    const auth = process.env.OIDC_ISSUER ? 'oidc' : process.env.AUTH_DEV_HEADERS === '1' ? 'dev-headers' : 'dev-headers(non-prod)';
    const body = {
      ready: dbOk,
      checks: {
        db: dbOk ? 'up' : 'down',
        storage,
        scanner,
        auth,
      },
      time: new Date().toISOString(),
    };
    res.status(dbOk ? 200 : 503).json(body);
  }
}
