import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { extractContext } from './request-context';
import { DomainError } from '../common/errors';

export const ROLES_KEY = 'required_roles';
/** 標註端點所需角色（任一符合即可）。 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * 角色守衛（§8 權限矩陣的骨架）。
 * 注意：細粒度 project/discipline scope 與 IDOR 檢查於服務層逐筆授權，
 * 此守衛僅做粗粒度角色閘門。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = extractContext(req);
    if (!ctx) throw new DomainError('authorization', 'unauthenticated', '缺少身分脈絡');
    (req as any).userContext = ctx;

    const ok = ctx.roles.some((r) => required.includes(r)) || ctx.roles.includes('Admin');
    if (!ok) throw DomainError.forbidden(`需要角色：${required.join(' / ')}`);
    return true;
  }
}
