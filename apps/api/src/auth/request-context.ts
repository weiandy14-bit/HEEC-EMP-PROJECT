import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Optional,
  CanActivate,
} from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../common/errors';
import { OidcService, oidcConfigured } from './oidc.service';
import { IdentityService } from './identity.service';

/**
 * 請求身分脈絡。
 *
 * 兩種來源，皆產生相同的 UserContext，下游 RBAC/scope 不需區分：
 *  1. 正式：Authorization: Bearer <OIDC JWT> → 驗章驗時效 → 以 (issuer,subject) 查 DB。
 *  2. 開發／測試替身：X-Org-Id / X-User-Id / X-Roles 標頭，預設僅非正式環境可用
 *     （NODE_ENV!=production），正式環境須顯式設 AUTH_DEV_HEADERS=1 才接受。
 *
 * 前端**不得**將開發標頭當成正式登入方案；正式部署由 OIDC SSO 驗證（§2、§8）。
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

/** 從開發替身標頭取出身分（僅在 devHeadersEnabled 時）。 */
export function extractDevContext(req: Request): UserContext | null {
  if (!devHeadersEnabled()) return null;
  const orgId = req.header('X-Org-Id');
  const userId = req.header('X-User-Id');
  if (!orgId || !userId) return null;
  const roles = (req.header('X-Roles') ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return { orgId, userId, roles };
}

/** 相容舊名：僅取開發標頭（不含 OIDC）。 */
export const extractContext = extractDevContext;

function bearerToken(req: Request): string | null {
  const h = req.header('authorization') ?? req.header('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/**
 * 統一身分解析，結果記憶於 req.userContext（同請求只解析一次）。
 * 優先順序：已解析 → 開發標頭（若啟用且存在）→ OIDC Bearer → 未驗證。
 */
export async function resolveUserContext(
  req: Request,
  oidc: OidcService | undefined,
  identity: IdentityService | undefined,
): Promise<UserContext | null> {
  const existing = (req as unknown as { userContext?: UserContext }).userContext;
  if (existing) return existing;

  const dev = extractDevContext(req);
  if (dev) {
    (req as unknown as { userContext?: UserContext }).userContext = dev;
    return dev;
  }

  const token = bearerToken(req);
  if (token && oidc && identity) {
    if (!oidcConfigured()) {
      throw new DomainError('infrastructure', 'oidc_unconfigured', 'OIDC 未設定', undefined, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const claims = await oidc.verify(token);
    const ctx = await identity.resolve(claims, {
      clientId: typeof claims.azp === 'string' ? claims.azp : undefined,
      sourceIp: req.ip,
    });
    (req as unknown as { userContext?: UserContext }).userContext = ctx;
    return ctx;
  }

  return null;
}

/** 要求已驗證身分之守衛。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Optional() private readonly oidc?: OidcService,
    @Optional() private readonly identity?: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = await resolveUserContext(req, this.oidc, this.identity);
    if (!ctx) throw new DomainError('authorization', 'unauthenticated', '缺少身分脈絡', undefined, HttpStatus.UNAUTHORIZED);
    return true;
  }
}

/** 取得目前使用者脈絡之參數裝飾器（AuthGuard 已於守衛階段填入 req.userContext）。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserContext => {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx =
      (req as unknown as { userContext?: UserContext }).userContext ?? extractDevContext(req);
    if (!ctx) throw new DomainError('authorization', 'unauthenticated', '缺少身分脈絡', undefined, HttpStatus.UNAUTHORIZED);
    return ctx;
  },
);
