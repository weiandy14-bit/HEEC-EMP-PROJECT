import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { CreateProjectDto, UpdateProjectDto } from './dto';

export interface ProjectRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  status: string;
  permit_filing_date: string | null;
  version: string;
  [k: string]: unknown;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  async list(ctx: UserContext, limit = 50, cursor?: string): Promise<ProjectRow[]> {
    // 游標分頁：以 (created_at,id) 排序；cursor 為上一頁末列 id（簡化）。
    return this.db.query<ProjectRow>(
      `SELECT * FROM projects
        WHERE org_id = $1 AND archived_at IS NULL
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id
        LIMIT $3`,
      [ctx.orgId, cursor ?? null, Math.min(limit, 200)],
    );
  }

  async get(ctx: UserContext, id: string): Promise<ProjectRow> {
    const row = await this.db.queryOne<ProjectRow>(
      `SELECT * FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.orgId, id],
    );
    if (!row) throw DomainError.notFound('專案');
    return row;
  }

  async create(ctx: UserContext, dto: CreateProjectDto): Promise<ProjectRow> {
    const dup = await this.db.queryOne(
      `SELECT 1 FROM projects WHERE org_id = $1 AND code = $2`,
      [ctx.orgId, dto.code],
    );
    if (dup) throw DomainError.conflict('duplicate_code', `專案代碼已存在：${dto.code}`);

    const row = await this.db.queryOne<ProjectRow>(
      `INSERT INTO projects
        (org_id, code, name, short_name, client_name, architect_name, pm_user_id,
         status, priority, design_start_date, permit_filing_date, default_calendar_id,
         timezone, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'planning'),COALESCE($9,3),$10,$11,$12,
               COALESCE($13,'Asia/Taipei'),$14,$15,$15)
       RETURNING *`,
      [
        ctx.orgId, dto.code, dto.name, dto.short_name ?? null, dto.client_name ?? null,
        dto.architect_name ?? null, dto.pm_user_id ?? null, dto.status ?? null,
        dto.priority ?? null, dto.design_start_date ?? null, dto.permit_filing_date ?? null,
        dto.default_calendar_id ?? null, dto.timezone ?? null, dto.notes ?? null, ctx.userId,
      ],
    );
    return row!;
  }

  /** 樂觀鎖更新：expectedVersion 來自 If-Match（§8 寫入要求 If-Match）。 */
  async update(
    ctx: UserContext,
    id: string,
    dto: UpdateProjectDto,
    expectedVersion: number,
  ): Promise<ProjectRow> {
    await this.get(ctx, id); // 確認存在與 org scope（IDOR 防護）

    const fields: string[] = [];
    const params: unknown[] = [ctx.orgId, id, expectedVersion];
    let i = 4;
    for (const [key, val] of Object.entries(dto)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${i++}`);
      params.push(val);
    }
    if (fields.length === 0) throw DomainError.validation('無可更新欄位');
    params.push(ctx.userId);

    const row = await this.db.queryOne<ProjectRow>(
      `UPDATE projects SET ${fields.join(', ')}, updated_by = $${i}
        WHERE org_id = $1 AND id = $2 AND version = $3 AND archived_at IS NULL
        RETURNING *`,
      params,
    );
    if (!row) {
      // 版本不符 → 412
      throw new DomainError(
        'conflict',
        'version_mismatch',
        '資源版本已變更，請重新載入後再試',
        undefined,
        412 as any,
      );
    }
    return row;
  }
}
