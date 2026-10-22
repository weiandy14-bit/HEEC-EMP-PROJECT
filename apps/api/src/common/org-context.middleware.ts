import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { orgContext } from './org-context';

/**
 * 於每個請求開頭建立空的組織脈絡 store，並以 AsyncLocalStorage 包住後續處理，
 * 使守衛（填入 orgId）與服務層（讀取 orgId）皆可在同一請求內共用。
 * 必須在路由與守衛之前註冊。
 */
@Injectable()
export class OrgContextMiddleware implements NestMiddleware {
  use = (_req: Request, _res: Response, next: NextFunction): void => {
    orgContext.run({}, () => next());
  };
}
