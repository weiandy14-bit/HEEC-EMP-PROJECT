import { createParamDecorator, ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../common/errors';

/**
 * 請求身分脈絡。
 * MVP 以標頭注入（X-Org-Id / X-User-Id / X-Roles）作為開發替身，
 * 正式部署改由 OIDC SSO 驗證後填入（§2、§8）。
 */
export interface UserContext {
  orgId: string;
  userId: string;
  roles: string[];
}

export function extractContext(req: Request): UserContext | null {
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
