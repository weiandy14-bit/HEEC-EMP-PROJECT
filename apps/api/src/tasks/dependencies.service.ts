import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';

const MAX_NEG_LAG = 30 * 480; // D06 預設上限

export interface CreateDepInput {
  predecessor_task_id: string;
  successor_task_id: string;
  relation?: string;
  lag_minutes?: number;
  note?: string;
}

@Injectable()
export class DependenciesService {
  constructor(private readonly db: DatabaseService) {}

  async create(ctx: UserContext, projectId: string, dto: CreateDepInput) {
    if (dto.predecessor_task_id === dto.successor_task_id) {
      throw DomainError.validation('前置與後續不可相同');
    }
    const lag = dto.lag_minutes ?? 0;
    if (lag < 0 && -lag > MAX_NEG_LAG) {
      throw DomainError.validation(`負 lag 超過上限 ${MAX_NEG_LAG} 分`);
    }
    // 確認兩端皆屬同案（IDOR + 跨案防護）
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM project_tasks
        WHERE org_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])`,
      [ctx.orgId, projectId, [dto.predecessor_task_id, dto.successor_task_id]],
    );
    if (rows.length !== 2) throw DomainError.validation('前置或後續工作不存在於本專案');

    try {
      const row = await this.db.queryOne(
        `INSERT INTO task_dependencies
           (org_id, project_id, predecessor_task_id, successor_task_id, relation, lag_minutes, note, created_by, updated_by)
         VALUES ($1,$2,$3,$4,COALESCE($5::dependency_relation,'FS'),$6,$7,$8,$8)
         RETURNING *`,
        [
          ctx.orgId, projectId, dto.predecessor_task_id, dto.successor_task_id,
          dto.relation ?? null, lag, dto.note ?? null, ctx.userId,
        ],
      );
      return row!;
    } catch (e: any) {
      if (e?.code === '23505') throw DomainError.conflict('duplicate_dependency', '相依關係已存在');
      throw e;
    }
  }

  async remove(ctx: UserContext, projectId: string, id: string): Promise<void> {
    const res = await this.db.query(
      `DELETE FROM task_dependencies WHERE org_id = $1 AND project_id = $2 AND id = $3 RETURNING id`,
      [ctx.orgId, projectId, id],
    );
    if (res.length === 0) throw DomainError.notFound('相依關係');
  }
}
