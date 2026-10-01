import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { GanttQueryDto } from './dto';

type Bar = { start: string | null; finish: string | null };
interface GanttTask {
  id: string;
  parent_id: string | null;
  wbs_code: string;
  sort_key: string;
  name: string;
  discipline_id: string | null;
  owner_user_id: string | null;
  milestone: boolean;
  summary: boolean;
  critical: boolean;
  status: string;
  percent_complete: number;
  planned: Bar;
  baseline: Bar;
  actual: Bar;
}
interface GanttDependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  relation: string;
  lag_minutes: number;
}
interface GanttMilestone {
  kind: 'permit_filing' | 'review_due';
  id: string;
  name: string;
  date: string;
}

/**
 * 頁 A 多案總控甘特讀模型（P4-A1）。
 * 即時查詢(不物化)：以 org scope 取可視進行中案件，批次併任務/相依/里程碑，無 N+1。
 * read-your-writes：直讀基表與 v_gantt_task。
 */
@Injectable()
export class GanttService {
  constructor(private readonly db: DatabaseService) {}

  private resolveStatus(status?: string): string {
    // 「進行中」= projects.status='active'；接受 in_progress 別名
    if (!status || status === 'in_progress') return 'active';
    return status;
  }

  async portfolio(ctx: UserContext, q: GanttQueryDto) {
    const zoom = q.zoom ?? 'week';
    const status = this.resolveStatus(q.status);
    const limit = q.limit ?? 100;

    // 1) 可視案件（org scope；僅該狀態、未封存）
    const params: unknown[] = [ctx.orgId, status];
    let sql = `SELECT id, name, status, health, permit_filing_date, pm_user_id
                 FROM projects
                WHERE org_id = $1 AND status = $2 AND archived_at IS NULL`;
    if (q.pm_id) { params.push(q.pm_id); sql += ` AND pm_user_id = $${params.length}`; }
    if (q.project_id) { params.push(q.project_id); sql += ` AND id = $${params.length}`; }
    params.push(limit);
    sql += ` ORDER BY code LIMIT $${params.length}`;
    const projects = await this.db.query<any>(sql, params);
    if (projects.length === 0) {
      return { zoom, from: q.from ?? null, to: q.to ?? null, projects: [] };
    }
    const ids = projects.map((p) => p.id);

    // 2) 任務（批次；可選日期區間相交與專業篩選）
    const tParams: unknown[] = [ctx.orgId, ids];
    let tSql = `SELECT project_id, id, parent_task_id, wbs_code, sort_key, name, discipline_id,
                       owner_user_id, milestone, summary, critical, status, percent_complete,
                       planned_start, planned_finish, actual_start, actual_finish,
                       baseline_start, baseline_finish
                  FROM v_gantt_task
                 WHERE org_id = $1 AND project_id = ANY($2)`;
    if (q.discipline) { tParams.push(q.discipline); tSql += ` AND discipline_id = $${tParams.length}`; }
    if (q.from) {
      tParams.push(q.from);
      tSql += ` AND (planned_finish IS NULL OR planned_finish >= $${tParams.length}
                     OR baseline_finish >= $${tParams.length} OR actual_finish >= $${tParams.length})`;
    }
    if (q.to) {
      tParams.push(q.to);
      tSql += ` AND (planned_start IS NULL OR planned_start < $${tParams.length}
                     OR baseline_start < $${tParams.length} OR actual_start < $${tParams.length})`;
    }
    tSql += ` ORDER BY project_id, sort_key`;
    const tasks = await this.db.query<any>(tSql, tParams);

    // 3) 相依（批次）
    const deps = await this.db.query<any>(
      `SELECT project_id, id, predecessor_task_id, successor_task_id, relation, lag_minutes
         FROM task_dependencies
        WHERE org_id = $1 AND project_id = ANY($2) AND archived_at IS NULL`,
      [ctx.orgId, ids],
    );

    // 4) 里程碑：掛件(每案唯一 permit_filing) + 法定審查期限(review_due，獨立)
    const reviews = await this.db.query<any>(
      `SELECT r.project_id, r.id,
              COALESCE(t.name, r.authority, '法定審查') AS name,
              r.legal_due_date
         FROM project_statutory_reviews r
         LEFT JOIN statutory_review_templates t ON t.id = r.template_id
        WHERE r.org_id = $1 AND r.project_id = ANY($2)
          AND r.archived_at IS NULL AND r.applicability <> 'not_applicable'
          AND r.legal_due_date IS NOT NULL`,
      [ctx.orgId, ids],
    );

    // 組裝
    const byProject = new Map<string, any>();
    for (const p of projects) {
      byProject.set(p.id, {
        id: p.id, name: p.name, status: p.status, health: p.health,
        permit_filing_date: p.permit_filing_date, pm_user_id: p.pm_user_id,
        tasks: [] as GanttTask[], dependencies: [] as GanttDependency[], milestones: [] as GanttMilestone[],
      });
      // 掛件里程碑：每案唯一，取 permit_filing_date（可空則不產生）
      if (p.permit_filing_date) {
        byProject.get(p.id).milestones.push({
          kind: 'permit_filing', id: p.id, name: '建照掛件', date: p.permit_filing_date,
        } as GanttMilestone);
      }
    }
    for (const t of tasks) {
      byProject.get(t.project_id)?.tasks.push({
        id: t.id, parent_id: t.parent_task_id, wbs_code: t.wbs_code, sort_key: t.sort_key,
        name: t.name, discipline_id: t.discipline_id, owner_user_id: t.owner_user_id,
        milestone: t.milestone, summary: t.summary, critical: t.critical,
        status: t.status, percent_complete: Number(t.percent_complete),
        planned: { start: t.planned_start, finish: t.planned_finish },
        baseline: { start: t.baseline_start, finish: t.baseline_finish },
        actual: { start: t.actual_start, finish: t.actual_finish },
      } as GanttTask);
    }
    for (const d of deps) {
      byProject.get(d.project_id)?.dependencies.push({
        id: d.id, predecessor_id: d.predecessor_task_id, successor_id: d.successor_task_id,
        relation: d.relation, lag_minutes: d.lag_minutes,
      } as GanttDependency);
    }
    for (const r of reviews) {
      byProject.get(r.project_id)?.milestones.push({
        kind: 'review_due', id: r.id, name: r.name, date: r.legal_due_date,
      } as GanttMilestone);
    }

    return {
      zoom, from: q.from ?? null, to: q.to ?? null,
      projects: projects.map((p) => byProject.get(p.id)),
    };
  }

  /** 單案 drill-down（跨案/跨 org → 404，不洩存在性）。 */
  async projectGantt(ctx: UserContext, projectId: string) {
    const p = await this.db.queryOne<any>(
      `SELECT id, name, status, health, permit_filing_date, pm_user_id
         FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.orgId, projectId],
    );
    if (!p) throw DomainError.notFound('專案');
    return this.portfolio(ctx, { project_id: projectId, status: p.status } as GanttQueryDto)
      .then((r) => r.projects[0] ?? null);
  }
}
