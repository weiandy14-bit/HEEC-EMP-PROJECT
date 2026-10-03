import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { CreateMeetingDto, UpdateMeetingDto } from './dto';

@Injectable()
export class MeetingsService {
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

  async list(ctx: UserContext, projectId: string) {
    await this.assertProject(ctx, projectId);
    return this.db.query(
      `SELECT id, project_id, starts_at, ends_at, timezone, topic, organizer_id, status,
              minutes_attachment_id, version
         FROM meetings
        WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL
        ORDER BY starts_at`,
      [ctx.orgId, projectId],
    );
  }

  async create(ctx: UserContext, projectId: string, dto: CreateMeetingDto) {
    await this.assertProject(ctx, projectId);
    if (dto.ends_at && Date.parse(dto.ends_at) < Date.parse(dto.starts_at)) {
      throw DomainError.validation('會議結束不得早於開始', { ends_at: ['must be >= starts_at'] });
    }
    return this.db.transaction(async (client) => {
      const res = await client.query(
        `INSERT INTO meetings
           (org_id, project_id, starts_at, ends_at, timezone, topic, organizer_id, status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,COALESCE($5,'Asia/Taipei'),$6,$7,'scheduled',$8,$8)
         RETURNING *`,
        [ctx.orgId, projectId, dto.starts_at, dto.ends_at ?? null, dto.timezone ?? null, dto.topic, dto.organizer_id ?? null, ctx.userId],
      );
      const row = res.rows[0];
      await this.audit.write(client, ctx, {
        entityType: 'meeting', entityId: row.id, action: 'create',
        diff: { topic: dto.topic, starts_at: dto.starts_at },
      });
      return row;
    });
  }

  async update(ctx: UserContext, projectId: string, id: string, dto: UpdateMeetingDto) {
    await this.assertProject(ctx, projectId);
    const existing = await this.db.queryOne<{ id: string; starts_at: string; status: string }>(
      `SELECT id, starts_at, status FROM meetings
        WHERE org_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL`,
      [ctx.orgId, projectId, id],
    );
    if (!existing) throw DomainError.notFound('會議');
    if (dto.ends_at && Date.parse(dto.ends_at) < Date.parse(existing.starts_at)) {
      throw DomainError.validation('會議結束不得早於開始', { ends_at: ['must be >= starts_at'] });
    }
    return this.db.transaction(async (client) => {
      let row: any;
      try {
        const res = await client.query(
          `UPDATE meetings
              SET status = COALESCE($4, status), ends_at = COALESCE($5, ends_at),
                  topic = COALESCE($6, topic), minutes_attachment_id = COALESCE($7, minutes_attachment_id),
                  organizer_id = COALESCE($8, organizer_id), updated_by = $9
            WHERE org_id = $1 AND project_id = $2 AND id = $3
            RETURNING *`,
          [ctx.orgId, projectId, id, dto.status ?? null, dto.ends_at ?? null, dto.topic ?? null,
           dto.minutes_attachment_id ?? null, dto.organizer_id ?? null, ctx.userId],
        );
        row = res.rows[0];
      } catch (e: any) {
        if (e?.code === '23503') throw DomainError.validation('紀錄附件不存在', { minutes_attachment_id: ['not found'] });
        throw e;
      }
      await this.audit.write(client, ctx, {
        entityType: 'meeting', entityId: id, action: 'update',
        diff: { status: { from: existing.status, to: dto.status ?? existing.status } },
      });
      return row;
    });
  }
}
