import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { CreateDeliverableDto, UpdateDeliverableDto, ReviseDeliverableDto, DeliverableStatus } from './dto';

interface DeliverableRow {
  id: string;
  project_id: string;
  name: string;
  revision: string;
  status: DeliverableStatus;
  locked_at: string | null;
  version: string;
  [k: string]: unknown;
}

/** 交付物版本遞增：A→B、數字 +1，其餘附加撇號。 */
function nextRevision(cur: string): string {
  if (/^[A-Y]$/.test(cur)) return String.fromCharCode(cur.charCodeAt(0) + 1);
  if (/^\d+$/.test(cur)) return String(Number(cur) + 1);
  return cur + "'";
}

@Injectable()
export class DeliverablesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async assertProject(ctx: UserContext, projectId: string): Promise<void> {
    const p = await this.db.queryOne(
      `SELECT 1 FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.orgId, projectId],
    );
    if (!p) throw DomainError.notFound('專案');
  }

  private async load(ctx: UserContext, projectId: string, id: string): Promise<DeliverableRow> {
    const row = await this.db.queryOne<DeliverableRow>(
      `SELECT * FROM deliverables
        WHERE org_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL`,
      [ctx.orgId, projectId, id],
    );
    if (!row) throw DomainError.notFound('交付物');
    return row;
  }

  async list(ctx: UserContext, projectId: string) {
    await this.assertProject(ctx, projectId);
    return this.db.query(
      `SELECT id, project_id, task_id, name, type, revision, status, due_at,
              submitted_at, accepted_at, approver_id, locked_at, version
         FROM deliverables
        WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL
        ORDER BY name, revision`,
      [ctx.orgId, projectId],
    );
  }

  async create(ctx: UserContext, projectId: string, dto: CreateDeliverableDto) {
    await this.assertProject(ctx, projectId);
    const revision = dto.revision ?? 'A';
    return this.db.transaction(async (client) => {
      let row: DeliverableRow;
      try {
        const res = await client.query<DeliverableRow>(
          `INSERT INTO deliverables
             (org_id, project_id, task_id, name, type, revision, status, due_at, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$8)
           RETURNING *`,
          [ctx.orgId, projectId, dto.task_id ?? null, dto.name, dto.type ?? null, revision, dto.due_at ?? null, ctx.userId],
        );
        row = res.rows[0];
      } catch (e: any) {
        if (e?.code === '23505') throw DomainError.conflict('duplicate_deliverable', `交付物已存在：${dto.name} rev ${revision}`);
        throw e;
      }
      await this.audit.write(client, ctx, {
        entityType: 'deliverable', entityId: row.id, action: 'create',
        diff: { name: dto.name, revision, status: 'draft' },
      });
      return row;
    });
  }

  /** 狀態流轉；locked 交付物不得直接修改（→ 409），後續變更須改建新 revision。 */
  async update(ctx: UserContext, projectId: string, id: string, dto: UpdateDeliverableDto) {
    await this.assertProject(ctx, projectId);
    const existing = await this.load(ctx, projectId, id);
    if (existing.status === 'locked') {
      throw DomainError.conflict('deliverable_locked', 'locked 交付物不可直接修改，請建立新 revision');
    }
    const nextStatus = dto.status ?? existing.status;

    return this.db.transaction(async (client) => {
      const res = await client.query<DeliverableRow>(
        `UPDATE deliverables
            SET status = $4,
                type = COALESCE($5, type),
                due_at = COALESCE($6, due_at),
                approver_id = COALESCE($7, approver_id),
                submitted_at = CASE WHEN $4 = 'submitted' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
                accepted_at  = CASE WHEN $4 = 'accepted'  AND accepted_at  IS NULL THEN now() ELSE accepted_at END,
                locked_at    = CASE WHEN $4 = 'locked'    AND locked_at    IS NULL THEN now() ELSE locked_at END,
                updated_by = $8
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          RETURNING *`,
        [ctx.orgId, projectId, id, nextStatus, dto.type ?? null, dto.due_at ?? null, dto.approver_id ?? null, ctx.userId],
      );
      await this.audit.write(client, ctx, {
        entityType: 'deliverable', entityId: id, action: 'update',
        diff: { status: { from: existing.status, to: nextStatus } },
      });
      return res.rows[0];
    });
  }

  /** 建立新 revision（locked 或任何版之後續變更走此路徑，不改動原版）。 */
  async revise(ctx: UserContext, projectId: string, id: string, dto: ReviseDeliverableDto) {
    await this.assertProject(ctx, projectId);
    const base = await this.load(ctx, projectId, id);
    const revision = dto.revision ?? nextRevision(base.revision);
    return this.db.transaction(async (client) => {
      let row: DeliverableRow;
      try {
        const res = await client.query<DeliverableRow>(
          `INSERT INTO deliverables
             (org_id, project_id, task_id, name, type, revision, status, due_at, created_by, updated_by)
           SELECT org_id, project_id, task_id, name, type, $4, 'draft', COALESCE($5, due_at), $6, $6
             FROM deliverables WHERE org_id = $1 AND project_id = $2 AND id = $3
           RETURNING *`,
          [ctx.orgId, projectId, id, revision, dto.due_at ?? null, ctx.userId],
        );
        row = res.rows[0];
      } catch (e: any) {
        if (e?.code === '23505') throw DomainError.conflict('duplicate_deliverable', `revision 已存在：${base.name} rev ${revision}`);
        throw e;
      }
      await this.audit.write(client, ctx, {
        entityType: 'deliverable', entityId: row.id, action: 'revise',
        diff: { from_id: id, from_revision: base.revision, new_revision: revision },
      });
      return row;
    });
  }

  /** DELETE 採封存（archived_at），保留列與稽核，不做實體刪除。 */
  async archive(ctx: UserContext, projectId: string, id: string) {
    await this.assertProject(ctx, projectId);
    const existing = await this.load(ctx, projectId, id);
    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE deliverables SET archived_at = now(), updated_by = $4
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, id, ctx.userId],
      );
      await this.audit.write(client, ctx, {
        entityType: 'deliverable', entityId: id, action: 'archive',
        diff: { name: existing.name, revision: existing.revision },
      });
    });
  }
}
