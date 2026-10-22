import { CanActivate, ExecutionContext, HttpStatus, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { resolveUserContext } from './request-context';
import { OidcService } from './oidc.service';
import { IdentityService } from './identity.service';
import { DomainError } from '../common/errors';

export const ROLES_KEY = 'required_roles';
/** 標註端點所需角色（任一符合即可）。 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * 角色守衛（§8 權限矩陣的骨架）。
 * 注意：細粒度 project/discipline scope 與 IDOR 檢查於服務層逐筆授權，
 * 此守衛僅做粗粒度角色閘門。身分來源（開發標頭或 OIDC）由 resolveUserContext 統一處理。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly oidc?: OidcService,
    @Optional() private readonly identity?: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = await resolveUserContext(req, this.oidc, this.identity);
    if (!ctx) throw new DomainError('authorization', 'unauthenticated', '缺少身分脈絡', undefined, HttpStatus.UNAUTHORIZED);

    const ok = ctx.roles.some((r) => required.includes(r)) || ctx.roles.includes('Admin');
    if (!ok) throw DomainError.forbidden(`需要角色：${required.join(' / ')}`);
    return true;
  }
}
