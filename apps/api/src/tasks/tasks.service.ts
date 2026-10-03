import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';

export interface CreateTaskInput {
  wbs_code: string;
  name: string;
  type?: string;
  discipline_id?: string;
  duration_minutes?: number;
  parent_task_id?: string;
  calendar_id?: string;
  constraint_type?: string;
  constraint_date?: string;
  milestone?: boolean;
  owner_user_id?: string;
}

@Injectable()
export class TasksService {
  constructor(private readonly db: DatabaseService) {}

  private async assertProject(ctx: UserContext, projectId: string): Promise<void> {
    const p = await this.db.queryOne(
      `SELECT 1 FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.orgId, projectId],
    );
    if (!p) throw DomainError.notFound('專案');
  }

  async list(ctx: UserContext, projectId: string) {
    await this.assertProject(ctx, projectId);
    return this.db.query(
      `SELECT id, wbs_code, sort_key, name, type, discipline_id, duration_minutes,
              planned_start, planned_finish, actual_start, actual_finish, percent_complete,
              constraint_type, constraint_date, milestone, critical,
              total_float_minutes, free_float_minutes, status, version
         FROM project_tasks
        WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL
        ORDER BY sort_key, wbs_code`,
      [ctx.orgId, projectId],
    );
  }

  async create(ctx: UserContext, projectId: string, dto: CreateTaskInput) {
    await this.assertProject(ctx, projectId);
    const dup = await this.db.queryOne(
      `SELECT 1 FROM project_tasks WHERE project_id = $1 AND wbs_code = $2`,
      [projectId, dto.wbs_code],
    );
    if (dup) throw DomainError.conflict('duplicate_wbs', `WBS 代碼已存在：${dto.wbs_code}`);

    const row = await this.db.queryOne(
      `INSERT INTO project_tasks
         (org_id, project_id, parent_task_id, wbs_code, sort_key, name, type,
          discipline_id, duration_minutes, calendar_id, constraint_type, constraint_date,
          milestone, owner_user_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::task_type,'task'),$8,COALESCE($9,0),$10,
               COALESCE($11::constraint_type,'ASAP'),$12,COALESCE($13,false),$14,$15,$15)
       RETURNING *`,
      [
        ctx.orgId, projectId, dto.parent_task_id ?? null, dto.wbs_code, dto.wbs_code,
        dto.name, dto.type ?? null, dto.discipline_id ?? null, dto.duration_minutes ?? null,
        dto.calendar_id ?? null, dto.constraint_type ?? null, dto.constraint_date ?? null,
        dto.milestone ?? null, dto.owner_user_id ?? null, ctx.userId,
      ],
    );
    return row!;
  }
}
