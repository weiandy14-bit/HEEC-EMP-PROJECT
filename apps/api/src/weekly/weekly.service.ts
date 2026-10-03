import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { CreateWeeklyItemDto, UpdateWeeklyItemDto } from './dto';

@Injectable()
export class WeeklyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async assertProject(ctx: UserContext, projectId: string): Promise<void> {
    const p = await this.db.queryOne(
      `SELECT 1 FROM projects p WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
       AND ($4::boolean OR p.created_by=$3 OR p.pm_user_id=$3 OR EXISTS
         (SELECT 1 FROM project_members m WHERE m.org_id=p.org_id AND m.project_id=p.id AND m.user_id=$3 AND m.archived_at IS NULL))`,
      [ctx.orgId, projectId, ctx.userId, ctx.roles.includes('Admin')],
    );
    if (!p) throw DomainError.notFound('專案');
  }

  /**
   * 列出某查詢週應顯示之週工作項（P3-06）：
   *   顯示條件 = 工作期間與查詢週相交（缺期間以 due_at 當點）
   *             或 逾期且未完成（期間/due_at 早於週起且 status ≠ done）。
   * 週界以 Asia/Taipei 週一 00:00 起算。source_key 僅去重，不決定週別。
   */
  async listForWeek(ctx: UserContext, projectId: string, week?: string) {
    await this.assertProject(ctx, projectId);
    if (!week) {
      return this.db.query(
        `SELECT * FROM weekly_items WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL
          ORDER BY due_at NULLS LAST`,
        [ctx.orgId, projectId],
      );
    }
    return this.db.query(
      `WITH bounds AS (
         SELECT (date_trunc('week', $3::date))::timestamp AT TIME ZONE 'Asia/Taipei' AS wstart,
                (date_trunc('week', $3::date) + interval '7 days')::timestamp AT TIME ZONE 'Asia/Taipei' AS wend
       )
       SELECT w.id, w.project_id, w.task_id, w.type, w.title, w.due_at, w.owner_id, w.status,
              w.period_start, w.period_end, w.source_key, w.completed_at, w.version,
              -- 逾期未完成置頂旗標
              (w.status <> 'done' AND COALESCE(w.period_end, w.due_at) < b.wstart) AS overdue
         FROM weekly_items w, bounds b
        WHERE w.org_id = $1 AND w.project_id = $2 AND w.archived_at IS NULL
          AND (
            (COALESCE(w.period_start, w.due_at) < b.wend AND COALESCE(w.period_end, w.due_at) >= b.wstart)
            OR (w.status <> 'done' AND COALESCE(w.period_end, w.due_at) < b.wstart)
          )
        ORDER BY overdue DESC, w.due_at NULLS LAST`,
      [ctx.orgId, projectId, week],
    );
  }

  async create(ctx: UserContext, projectId: string, dto: CreateWeeklyItemDto) {
    await this.assertProject(ctx, projectId);
    return this.db.transaction(async (client) => {
      let row: any;
      try {
        const res = await client.query(
          `INSERT INTO weekly_items
             (org_id, project_id, task_id, type, title, due_at, period_start, period_end,
              owner_id, status, source_key, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$11)
           RETURNING *`,
          [
            ctx.orgId, projectId, dto.task_id ?? null, dto.type ?? 'general', dto.title,
            dto.due_at ?? null, dto.period_start ?? null, dto.period_end ?? null,
            dto.owner_id ?? null, dto.source_key, ctx.userId,
          ],
        );
        row = res.rows[0];
      } catch (e: any) {
        // source_key 去重：同來源不重複建列
        if (e?.code === '23505') throw DomainError.conflict('duplicate_source_key', `週工作項已存在：${dto.source_key}`);
        throw e;
      }
      await this.audit.write(client, ctx, {
        entityType: 'weekly_item', entityId: row.id, action: 'create',
        diff: { source_key: dto.source_key, title: dto.title },
      });
      return row;
    });
  }

  async update(ctx: UserContext, projectId: string, id: string, dto: UpdateWeeklyItemDto) {
    await this.assertProject(ctx, projectId);
    const existing = await this.db.queryOne<{ id: string; status: string; owner_id: string | null }>(
      `SELECT id, status, owner_id FROM weekly_items
        WHERE org_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL`,
      [ctx.orgId, projectId, id],
    );
    if (!existing) throw DomainError.notFound('週工作項');
    if (ctx.roles.includes('Engineer') && !ctx.roles.some(r=>['Admin','PM','Lead'].includes(r)) && existing.owner_id!==ctx.userId) throw DomainError.forbidden('僅能更新本人週工作');
    const status = dto.status ?? existing.status;
    return this.db.transaction(async (client) => {
      const res = await client.query(
        `UPDATE weekly_items
            SET status = $4, due_at = COALESCE($5, due_at),
                period_start = COALESCE($6, period_start), period_end = COALESCE($7, period_end),
                completed_at = CASE WHEN $4 = 'done' AND completed_at IS NULL THEN now()
                                    WHEN $4 <> 'done' THEN NULL ELSE completed_at END,
                updated_by = $8
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          RETURNING *`,
        [ctx.orgId, projectId, id, status, dto.due_at ?? null, dto.period_start ?? null, dto.period_end ?? null, ctx.userId],
      );
      await this.audit.write(client, ctx, {
        entityType: 'weekly_item', entityId: id, action: 'update',
        diff: { status: { from: existing.status, to: status } },
      });
      return res.rows[0];
    });
  }
}
