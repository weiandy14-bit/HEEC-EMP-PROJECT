import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** 為每個請求建立/延用 X-Correlation-ID，並回寫回應標頭（§8）。 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('X-Correlation-ID');
    const correlationId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    (req as any).correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    next();
  };
}
