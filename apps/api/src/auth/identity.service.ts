import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { JwtClaims } from './jwt';
import type { UserContext } from './request-context';

/**
 * 身分對應（DB 權威）。
 * 將「已驗證之 OIDC claims」對應到本系統使用者，組織與角色一律讀 DB——
 * IdP 僅證明「此人是誰」，不決定其在本系統的權限。
 *
 * - 以 (issuer, subject) 唯一鍵查 users；查無或非 active → 拒絕（不做 JIT 佈建）。
 * - 角色載入該使用者所有未過期之 user_roles 角色代碼（跨 org/project/discipline scope）；
 *   粗粒度角色閘門用此清單，細粒度 scope 仍由服務層逐筆授權（維持既有語義）。
 * - last_login_at 以時間窗節流更新，避免每個請求（Bearer 無狀態）都寫入；
 *   實際更新的那次才補一筆 login_events，作為「觀察到新工作階段」之稽核。
 * - 以短 TTL 記憶體快取解析結果，降低每請求 DB 往返；角色異動於 TTL 內生效。
 */

interface CacheEntry {
  ctx: UserContext;
  at: number;
}

interface LoginMeta {
  clientId?: string;
  sourceIp?: string;
}

@Injectable()
export class IdentityService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly db: DatabaseService) {}

  private ttlMs(): number {
    return Number(process.env.AUTH_CONTEXT_TTL_MS ?? 30_000);
  }

  /** 清除指定使用者之快取（角色異動後可呼叫以即時生效）。 */
  invalidate(issuer: string, subject: string): void {
    this.cache.delete(`${issuer}\u0000${subject}`);
  }

  async resolve(claims: JwtClaims, meta: LoginMeta = {}): Promise<UserContext> {
    const issuer = String(claims.iss);
    const subject = String(claims.sub);
    const cacheKey = `${issuer}\u0000${subject}`;
    const ttl = this.ttlMs();
    const cached = this.cache.get(cacheKey);
    if (cached && ttl > 0 && Date.now() - cached.at < ttl) return cached.ctx;

    const user = await this.db.queryOne<{ id: string; org_id: string; status: string }>(
      `SELECT id, org_id, status FROM users WHERE issuer = $1 AND subject = $2 AND archived_at IS NULL`,
      [issuer, subject],
    );
    if (!user) {
      // DB 權威：未佈建之身分一律拒絕，需由 Admin 先行建立/邀請。
      throw new DomainError('authorization', 'user_not_provisioned', '此帳號尚未於本系統佈建', undefined, HttpStatus.FORBIDDEN);
    }
    if (user.status !== 'active') {
      throw new DomainError('authorization', 'user_inactive', '帳號未啟用', undefined, HttpStatus.FORBIDDEN);
    }

    const roleRows = await this.db.query<{ code: string }>(
      `SELECT DISTINCT r.code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND ur.archived_at IS NULL
          AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
      [user.id],
    );
    const ctx: UserContext = {
      orgId: user.org_id,
      userId: user.id,
      roles: roleRows.map((r) => r.code),
    };

    await this.recordSession(user.id, user.org_id, claims, meta).catch(() => undefined);

    if (ttl > 0) this.cache.set(cacheKey, { ctx, at: Date.now() });
    return ctx;
  }

  /**
   * 節流更新 last_login_at，並在實際更新時補稽核。
   * WHERE 內的時間窗保證並行請求只有一個會真正更新，避免讀改寫競態。
   */
  private async recordSession(userId: string, orgId: string, claims: JwtClaims, meta: LoginMeta): Promise<void> {
    const windowMs = Number(process.env.AUTH_SESSION_WINDOW_MS ?? 5 * 60 * 1000);
    const updated = await this.db.query<{ id: string }>(
      `UPDATE users SET last_login_at = now()
        WHERE id = $1
          AND (last_login_at IS NULL OR last_login_at < now() - ($2::bigint * interval '1 millisecond'))
        RETURNING id`,
      [userId, windowMs],
    );
    if (updated.length === 0) return; // 同一時間窗內已記錄
    const clientId = meta.clientId ?? (typeof claims.azp === 'string' ? claims.azp : undefined);
    await this.db.query(
      `INSERT INTO login_events (org_id, user_id, source_ip, client_id, outcome, detail)
       VALUES ($1, $2, $3::text::inet, $4, 'success', $5::jsonb)`,
      [
        orgId,
        userId,
        meta.sourceIp ?? null,
        clientId ?? null,
        JSON.stringify({ iss: claims.iss, jti: claims.jti ?? null, bearer: true }),
      ],
    );
  }
}
