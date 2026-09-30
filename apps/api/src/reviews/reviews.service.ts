import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type {
  Applicability,
  CreateReviewDto,
  UpdateReviewDto,
  CreateReviewStepDto,
  UpdateReviewStepDto,
} from './dto';

interface ReviewRow {
  id: string;
  project_id: string;
  template_id: string;
  template_version: number;
  applicability: Applicability;
  na_reason: string | null;
  confirmation_owner_id: string | null;
  confirmation_due_date: string | null;
  authority: string | null;
  status: string;
  version: string;
  [k: string]: unknown;
}

@Injectable()
export class ReviewsService {
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

  /** 依適用性驗證必填欄位（P3-01 狀態機規則）。 */
  private validateApplicability(state: {
    applicability: Applicability;
    na_reason?: string | null;
    confirmation_owner_id?: string | null;
    confirmation_due_date?: string | null;
  }): void {
    if (state.applicability === 'not_applicable' && !state.na_reason) {
      throw DomainError.validation('N/A 必填理由（na_reason）', { na_reason: ['required when not_applicable'] });
    }
    if (
      state.applicability === 'pending' &&
      (!state.confirmation_owner_id || !state.confirmation_due_date)
    ) {
      throw DomainError.validation('pending 必填責任人與期限', {
        confirmation_owner_id: ['required when pending'],
        confirmation_due_date: ['required when pending'],
      });
    }
  }

  async list(ctx: UserContext, projectId: string): Promise<ReviewRow[]> {
    await this.assertProject(ctx, projectId);
    return this.db.query<ReviewRow>(
      `SELECT id, project_id, template_id, template_version, applicability, na_reason,
              confirmation_owner_id, confirmation_due_date, authority, responsible_org,
              legal_due_date, status, approval_number, approval_date, notes, version
         FROM project_statutory_reviews
        WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL
        ORDER BY created_at`,
      [ctx.orgId, projectId],
    );
  }

  async create(ctx: UserContext, projectId: string, dto: CreateReviewDto): Promise<ReviewRow> {
    await this.assertProject(ctx, projectId);
    const applicability: Applicability = dto.applicability ?? 'pending';
    this.validateApplicability({
      applicability,
      na_reason: dto.na_reason,
      confirmation_owner_id: dto.confirmation_owner_id,
      confirmation_due_date: dto.confirmation_due_date,
    });

    const tpl = await this.db.queryOne<{ id: string; current_version: number }>(
      `SELECT id, current_version FROM statutory_review_templates
        WHERE org_id = $1 AND id = $2 AND status = 'active'`,
      [ctx.orgId, dto.template_id],
    );
    if (!tpl) throw DomainError.validation('審查模板不存在或未啟用', { template_id: ['not found'] });
    const templateVersion = dto.template_version ?? tpl.current_version;
    const status = applicability === 'not_applicable' ? 'na' : 'pending';

    return this.db.transaction(async (client) => {
      let row: ReviewRow;
      try {
        const res = await client.query<ReviewRow>(
          `INSERT INTO project_statutory_reviews
             (org_id, project_id, template_id, template_version, applicability, na_reason,
              confirmation_owner_id, confirmation_due_date, authority, responsible_org,
              legal_due_date, status, notes, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
           RETURNING *`,
          [
            ctx.orgId, projectId, dto.template_id, templateVersion, applicability,
            dto.na_reason ?? null, dto.confirmation_owner_id ?? null, dto.confirmation_due_date ?? null,
            dto.authority ?? null, dto.responsible_org ?? null, dto.legal_due_date ?? null,
            status, dto.notes ?? null, ctx.userId,
          ],
        );
        row = res.rows[0];
      } catch (e: any) {
        if (e?.code === '23505') throw DomainError.conflict('duplicate_review', '該模板之審查已存在');
        throw e;
      }
      await client.query(
        `INSERT INTO review_events (org_id, review_id, event_type, actor_id, payload)
         VALUES ($1,$2,'created',$3,$4)`,
        [ctx.orgId, row.id, ctx.userId, JSON.stringify({ applicability, template_version: templateVersion })],
      );
      await this.audit.write(client, ctx, {
        entityType: 'statutory_review',
        entityId: row.id,
        action: 'create',
        diff: { applicability, template_id: dto.template_id, status },
      });
      return row;
    });
  }

  async update(
    ctx: UserContext,
    projectId: string,
    reviewId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewRow> {
    await this.assertProject(ctx, projectId);
    const existing = await this.db.queryOne<ReviewRow>(
      `SELECT * FROM project_statutory_reviews
        WHERE org_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL`,
      [ctx.orgId, projectId, reviewId],
    );
    if (!existing) throw DomainError.notFound('審查');

    // 合併後狀態再驗證（P3-01 規則）
    const next = {
      applicability: dto.applicability ?? existing.applicability,
      na_reason: dto.na_reason ?? existing.na_reason,
      confirmation_owner_id: dto.confirmation_owner_id ?? existing.confirmation_owner_id,
      confirmation_due_date: dto.confirmation_due_date ?? existing.confirmation_due_date,
    };
    this.validateApplicability(next);

    // 狀態轉換：N/A 強制 na；否則採 dto.status 或維持現值
    const status =
      next.applicability === 'not_applicable' ? 'na' : (dto.status ?? existing.status);

    // P3-03 核可需文號＋日期：轉 approved 時必填 approval_number + approval_date
    const approvalNumber = dto.approval_number ?? (existing.approval_number as string | null);
    const approvalDate = dto.approval_date ?? (existing.approval_date as string | null);
    if (status === 'approved' && (!approvalNumber || !approvalDate)) {
      throw DomainError.validation('核可需文號與日期', {
        approval_number: ['required when approved'],
        approval_date: ['required when approved'],
      });
    }

    return this.db.transaction(async (client) => {
      const res = await client.query<ReviewRow>(
        `UPDATE project_statutory_reviews
            SET applicability = $4, na_reason = $5, confirmation_owner_id = $6,
                confirmation_due_date = $7, authority = COALESCE($8, authority),
                responsible_org = COALESCE($9, responsible_org),
                legal_due_date = COALESCE($10, legal_due_date),
                notes = COALESCE($11, notes), status = $12,
                approval_number = $14, approval_date = $15, updated_by = $13
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          RETURNING *`,
        [
          ctx.orgId, projectId, reviewId, next.applicability, next.na_reason,
          next.confirmation_owner_id, next.confirmation_due_date, dto.authority ?? null,
          dto.responsible_org ?? null, dto.legal_due_date ?? null, dto.notes ?? null, status, ctx.userId,
          status === 'approved' ? approvalNumber : (dto.approval_number ?? existing.approval_number ?? null),
          status === 'approved' ? approvalDate : (dto.approval_date ?? existing.approval_date ?? null),
        ],
      );
      const row = res.rows[0];
      if (dto.applicability && dto.applicability !== existing.applicability) {
        await client.query(
          `INSERT INTO review_events (org_id, review_id, event_type, actor_id, payload)
           VALUES ($1,$2,'applicability_changed',$3,$4)`,
          [ctx.orgId, reviewId, ctx.userId, JSON.stringify({ from: existing.applicability, to: next.applicability })],
        );
      }
      if (status !== existing.status) {
        await client.query(
          `INSERT INTO review_events (org_id, review_id, event_type, actor_id, payload)
           VALUES ($1,$2,$3,$4,$5)`,
          [ctx.orgId, reviewId, status === 'approved' ? 'approved' : 'status_changed', ctx.userId,
           JSON.stringify({ from: existing.status, to: status, approval_number: approvalNumber })],
        );
      }
      await this.audit.write(client, ctx, {
        entityType: 'statutory_review',
        entityId: reviewId,
        action: 'update',
        diff: {
          applicability: { from: existing.applicability, to: next.applicability },
          status: { from: existing.status, to: status },
        },
      });
      return row;
    });
  }

  // ------------------------------------------------------------------ 審查步驟（P3-02）

  private async assertReview(ctx: UserContext, projectId: string, reviewId: string): Promise<void> {
    const r = await this.db.queryOne(
      `SELECT 1 FROM project_statutory_reviews
        WHERE org_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL`,
      [ctx.orgId, projectId, reviewId],
    );
    if (!r) throw DomainError.notFound('審查');
  }

  async listSteps(ctx: UserContext, projectId: string, reviewId: string) {
    await this.assertProject(ctx, projectId);
    await this.assertReview(ctx, projectId, reviewId);
    return this.db.query(
      `SELECT id, review_id, template_step_id, step_code, cycle_no, status,
              planned_at, actual_at, due_at, owner_id, notes, version
         FROM project_statutory_review_steps
        WHERE org_id = $1 AND review_id = $2 AND archived_at IS NULL
        ORDER BY step_code, cycle_no`,
      [ctx.orgId, reviewId],
    );
  }

  /** 建立審查步驟；cycle_no 省略時自動取該 step_code 之次一循環（送審→補正→再送審）。 */
  async createStep(ctx: UserContext, projectId: string, reviewId: string, dto: CreateReviewStepDto) {
    await this.assertProject(ctx, projectId);
    await this.assertReview(ctx, projectId, reviewId);
    const status = dto.status ?? 'submitted';

    return this.db.transaction(async (client) => {
      let cycleNo = dto.cycle_no;
      if (cycleNo === undefined) {
        const m = await client.query<{ next: number }>(
          `SELECT COALESCE(MAX(cycle_no),0)+1 AS next
             FROM project_statutory_review_steps WHERE review_id = $1 AND step_code = $2`,
          [reviewId, dto.step_code],
        );
        cycleNo = Number(m.rows[0].next);
      }
      let row: any;
      try {
        const res = await client.query(
          `INSERT INTO project_statutory_review_steps
             (org_id, review_id, template_step_id, step_code, cycle_no, status,
              planned_at, actual_at, due_at, owner_id, notes, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
           RETURNING *`,
          [
            ctx.orgId, reviewId, dto.template_step_id ?? null, dto.step_code, cycleNo, status,
            dto.planned_at ?? null, dto.actual_at ?? null, dto.due_at ?? null,
            dto.owner_id ?? null, dto.notes ?? null, ctx.userId,
          ],
        );
        row = res.rows[0];
      } catch (e: any) {
        if (e?.code === '23505') {
          throw DomainError.conflict('duplicate_step', `步驟已存在：${dto.step_code} cycle ${cycleNo}`);
        }
        throw e;
      }
      await client.query(
        `INSERT INTO review_events (org_id, review_id, step_id, event_type, actor_id, payload)
         VALUES ($1,$2,$3,'step_created',$4,$5)`,
        [ctx.orgId, reviewId, row.id, ctx.userId, JSON.stringify({ step_code: dto.step_code, cycle_no: cycleNo, status })],
      );
      await this.audit.write(client, ctx, {
        entityType: 'review_step',
        entityId: row.id,
        action: 'create',
        diff: { review_id: reviewId, step_code: dto.step_code, cycle_no: cycleNo, status },
      });
      return row;
    });
  }

  async updateStep(
    ctx: UserContext,
    projectId: string,
    reviewId: string,
    stepId: string,
    dto: UpdateReviewStepDto,
  ) {
    await this.assertProject(ctx, projectId);
    await this.assertReview(ctx, projectId, reviewId);
    const existing = await this.db.queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM project_statutory_review_steps
        WHERE org_id = $1 AND review_id = $2 AND id = $3 AND archived_at IS NULL`,
      [ctx.orgId, reviewId, stepId],
    );
    if (!existing) throw DomainError.notFound('審查步驟');

    return this.db.transaction(async (client) => {
      const res = await client.query(
        `UPDATE project_statutory_review_steps
            SET status = COALESCE($4, status), actual_at = COALESCE($5, actual_at),
                owner_id = COALESCE($6, owner_id), notes = COALESCE($7, notes), updated_by = $8
          WHERE org_id = $1 AND review_id = $2 AND id = $3
          RETURNING *`,
        [ctx.orgId, reviewId, stepId, dto.status ?? null, dto.actual_at ?? null, dto.owner_id ?? null, dto.notes ?? null, ctx.userId],
      );
      const row = res.rows[0];
      await client.query(
        `INSERT INTO review_events (org_id, review_id, step_id, event_type, actor_id, payload)
         VALUES ($1,$2,$3,'step_status_changed',$4,$5)`,
        [ctx.orgId, reviewId, stepId, ctx.userId, JSON.stringify({ from: existing.status, to: dto.status ?? existing.status })],
      );
      await this.audit.write(client, ctx, {
        entityType: 'review_step',
        entityId: stepId,
        action: 'update',
        diff: { status: { from: existing.status, to: dto.status ?? existing.status } },
      });
      return row;
    });
  }
}
