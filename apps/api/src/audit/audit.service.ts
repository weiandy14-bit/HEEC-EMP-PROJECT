import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { UserContext } from '../auth/request-context';

export interface AuditEntry {
  entityType: string;
  entityId?: string | null;
  action: string;
  diff?: Record<string, unknown>;
  correlationId?: string | null;
}

/**
 * 稽核寫入（§8）：append-only + hash chain。於呼叫端交易內執行，
 * 以每組織 advisory lock 序列化，計算 integrity_hash = sha256(previous_hash + 內容)。
 * 敏感欄位由呼叫端於 diff 傳入前遮罩。
 */
@Injectable()
export class AuditService {
  async write(client: PoolClient, ctx: UserContext, entry: AuditEntry): Promise<void> {
    // 序列化同組織之稽核鏈，避免並發分叉
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ctx.orgId]);
    const prev = await client.query<{ integrity_hash: string }>(
      `SELECT integrity_hash FROM audit_logs WHERE org_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [ctx.orgId],
    );
    const previousHash = prev.rows[0]?.integrity_hash ?? null;
    const diff = entry.diff ?? {};
    const canonical = JSON.stringify({
      org: ctx.orgId,
      actor: ctx.userId,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      action: entry.action,
      diff,
      prev: previousHash,
    });
    const integrityHash = createHash('sha256').update(canonical).digest('hex');
    await client.query(
      `INSERT INTO audit_logs
         (org_id, actor_id, entity_type, entity_id, action, diff_redacted,
          correlation_id, integrity_hash, previous_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        ctx.orgId, ctx.userId, entry.entityType, entry.entityId ?? null, entry.action,
        JSON.stringify(diff), entry.correlationId ?? null, integrityHash, previousHash,
      ],
    );
  }
}
