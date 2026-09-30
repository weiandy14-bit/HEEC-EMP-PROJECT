import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { Applicability, CreateReviewDto, UpdateReviewDto } from './dto';

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
    const status = next.applicability === 'not_applicable' ? 'na' : existing.status;

    return this.db.transaction(async (client) => {
      const res = await client.query<ReviewRow>(
        `UPDATE project_statutory_reviews
            SET applicability = $4, na_reason = $5, confirmation_owner_id = $6,
                confirmation_due_date = $7, authority = COALESCE($8, authority),
                responsible_org = COALESCE($9, responsible_org),
                legal_due_date = COALESCE($10, legal_due_date),
                notes = COALESCE($11, notes), status = $12, updated_by = $13
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          RETURNING *`,
        [
          ctx.orgId, projectId, reviewId, next.applicability, next.na_reason,
          next.confirmation_owner_id, next.confirmation_due_date, dto.authority ?? null,
          dto.responsible_org ?? null, dto.legal_due_date ?? null, dto.notes ?? null, status, ctx.userId,
        ],
      );
      const row = res.rows[0];
      await client.query(
        `INSERT INTO review_events (org_id, review_id, event_type, actor_id, payload)
         VALUES ($1,$2,'applicability_changed',$3,$4)`,
        [ctx.orgId, reviewId, ctx.userId, JSON.stringify({ from: existing.applicability, to: next.applicability })],
      );
      await this.audit.write(client, ctx, {
        entityType: 'statutory_review',
        entityId: reviewId,
        action: 'update',
        diff: { applicability: { from: existing.applicability, to: next.applicability } },
      });
      return row;
    });
  }
}
