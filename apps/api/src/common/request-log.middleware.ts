import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { metrics } from './metrics';

/**
 * 結構化存取日誌（每請求一行 JSON）與指標記錄。
 * 以 X-Correlation-ID 串接；身分（org/user）於守衛階段填入 req.userContext 後可得。
 * 設 LOG_REQUESTS=0 可關閉日誌輸出（仍記錄指標）。不記錄請求主體或標頭，避免外洩。
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      metrics.observeRequest(req.method, res.statusCode, durationMs);
      if (process.env.LOG_REQUESTS === '0') return;
      const ctx = (req as unknown as { userContext?: { orgId: string; userId: string } }).userContext;
      const line = {
        t: new Date().toISOString(),
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        msg: 'request',
        correlation_id: (req as unknown as { correlationId?: string }).correlationId,
        method: req.method,
        path: req.originalUrl?.split('?')[0] ?? req.url,
        status: res.statusCode,
        dur_ms: Math.round(durationMs * 1000) / 1000,
        org_id: ctx?.orgId,
        user_id: ctx?.userId,
      };

      console.log(JSON.stringify(line));
    });
    next();
  };
}
