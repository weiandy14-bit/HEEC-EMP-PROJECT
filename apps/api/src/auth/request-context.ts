import { createParamDecorator, ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../common/errors';

/**
 * 請求身分脈絡。
 * X-Org-Id / X-User-Id / X-Roles 僅為**開發／測試環境**之身分替身，
 * 預設在正式環境（NODE_ENV=production）停用，除非顯式設 AUTH_DEV_HEADERS=1。
 * 前端**不得**將此標頭當成正式帳號密碼登入方案；正式部署由 OIDC SSO 驗證後填入（§2、§8）。
 */
export interface UserContext {
  orgId: string;
  userId: string;
  roles: string[];
}

/** 開發替身標頭是否可用（正式環境預設停用）。 */
export function devHeadersEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.AUTH_DEV_HEADERS === '1';
}

export function extractContext(req: Request): UserContext | null {
  if (!devHeadersEnabled()) return null; // 正式環境不接受開發替身標頭
  const orgId = req.header('X-Org-Id');
  const userId = req.header('X-User-Id');
  if (!orgId || !userId) return null;
  const roles = (req.header('X-Roles') ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return { orgId, userId, roles };
}

/** 要求已驗證身分之守衛。 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = extractContext(req);
    if (!ctx) throw new DomainError('authorization', 'unauthenticated', '缺少身分脈絡');
    (req as any).userContext = ctx;
    return true;
  }
}

/** 取得目前使用者脈絡之參數裝飾器。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserContext => {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = (req as any).userContext ?? extractContext(req);
    if (!ctx) throw new DomainError('authorization', 'unauthenticated', '缺少身分脈絡');
    return ctx;
  },
);
