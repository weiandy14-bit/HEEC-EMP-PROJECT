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

  // 可視範圍述詞（project scope）：建立者 / PM / Admin / 專案成員，否則不可見。
  // 參數位置：$1=org, $3=userId, $4=isAdmin（與 portfolio 的參數配置一致）。
  private static readonly VISIBILITY =
    `( $4 OR p.created_by = $3 OR p.pm_user_id = $3
       OR EXISTS (SELECT 1 FROM project_members m
                   WHERE m.project_id = p.id AND m.user_id = $3 AND m.archived_at IS NULL) )`;

  private encodeCursor(code: string): string {
    return Buffer.from(code, 'utf8').toString('base64url');
  }
  private decodeCursor(cursor?: string): string | null {
    if (!cursor) return null;
    try { return Buffer.from(cursor, 'base64url').toString('utf8'); } catch { return null; }
  }

  async portfolio(ctx: UserContext, q: GanttQueryDto) {
    if (q.from && q.to && Date.parse(q.from) >= Date.parse(q.to)) {
      throw DomainError.validation('結束日期必須晚於開始日期');
    }
    if (q.from && q.to && Date.parse(q.to) - Date.parse(q.from) > 3660 * 86400000) {
      throw DomainError.validation('查詢範圍最多十年，請縮小日期區間');
    }
    const taskLimit = q.task_limit ?? 200;
    let taskAfter: [string,string] | null = null;
    if (q.task_cursor) {
      if (!q.project_id) throw DomainError.validation('工作游標須指定案件');
      try {
        const value: unknown = JSON.parse(Buffer.from(q.task_cursor,'base64url').toString('utf8'));
        if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string'
          || typeof value[1] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value[1])) throw new Error('cursor');
        taskAfter = [value[0],value[1]];
      } catch { throw DomainError.validation('工作游標無效，請重新載入案件'); }
    }
    const zoom = q.zoom ?? 'week';
    const status = this.resolveStatus(q.status);
    const limit = q.limit ?? 50;
    const isAdmin = ctx.roles.includes('Admin');
    const afterCode = this.decodeCursor(q.cursor);

    // 1) 可視案件（org scope + project scope；僅該狀態、未封存；游標 keyset by code）
    const params: unknown[] = [ctx.orgId, status, ctx.userId, isAdmin];
    let sql = `SELECT p.id, p.code, p.name, p.status, p.health, p.permit_filing_date, p.pm_user_id
                 FROM projects p
                WHERE p.org_id = $1 AND p.status = $2 AND p.archived_at IS NULL
                  AND ${GanttService.VISIBILITY}`;
    if (q.pm_id) { params.push(q.pm_id); sql += ` AND p.pm_user_id = $${params.length}`; }
    if (q.project_id) { params.push(q.project_id); sql += ` AND p.id = $${params.length}`; }
    if (q.resource_id) {
      params.push(q.resource_id);
      sql += ` AND EXISTS (SELECT 1 FROM resource_assignments a
        WHERE a.org_id=p.org_id AND a.project_id=p.id AND a.resource_id=$${params.length} AND a.archived_at IS NULL)`;
    }
    if (afterCode) { params.push(afterCode); sql += ` AND p.code > $${params.length}`; }
    params.push(limit + 1); // 多取一列以判斷是否尚有下一頁
    sql += ` ORDER BY p.code LIMIT $${params.length}`;
    const rows = await this.db.query<any>(sql, params);
    const hasMore = rows.length > limit;
    const projects = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? this.encodeCursor(projects[projects.length - 1].code) : null;
    if (projects.length === 0) {
      return { zoom, from: q.from ?? null, to: q.to ?? null, next_cursor: null, projects: [] };
    }
    const ids = projects.map((p) => p.id);

    // Filter matched leaves in SQL, then keep ancestors so filtered WBS remains navigable.
    const tParams: unknown[] = [ctx.orgId, ids];
    let where = 't.org_id=$1 AND t.project_id=ANY($2)';
    if (q.discipline) { tParams.push(q.discipline); where += ` AND t.discipline_id=$${tParams.length}`; }
    if (q.resource_id) {
      tParams.push(q.resource_id);
      where += ` AND EXISTS (SELECT 1 FROM resource_assignments a WHERE a.org_id=t.org_id
        AND a.project_id=t.project_id AND a.task_id=t.id AND a.resource_id=$${tParams.length} AND a.archived_at IS NULL)`;
    }
    let fromParam: number | null = null, toParam: number | null = null;
    if (q.from) { tParams.push(q.from); fromParam = tParams.length; }
    if (q.to) { tParams.push(q.to); toParam = tParams.length; }
    if (fromParam || toParam) {
      where += ' AND (' + ['planned','baseline','actual'].map((kind) => {
        const conditions = [`t.${kind}_start IS NOT NULL`];
        if (fromParam) conditions.push(kind === 'actual'
          ? `(t.actual_finish IS NULL OR t.actual_finish > $${fromParam} OR (t.actual_finish=t.actual_start AND t.actual_start >= $${fromParam}))`
          : `(COALESCE(t.${kind}_finish,t.${kind}_start) > $${fromParam} OR (t.${kind}_finish=t.${kind}_start AND t.${kind}_start >= $${fromParam}))`);
        if (toParam) conditions.push(`t.${kind}_start < $${toParam}`);
        return '(' + conditions.join(' AND ') + ')';
      }).join(' OR ') + ')';
    }
    if (taskAfter) {
      tParams.push(taskAfter[0],taskAfter[1]);
      where += ` AND (t.sort_key,t.id) > ($${tParams.length-1},$${tParams.length}::uuid)`;
    }
    tParams.push(taskLimit);
    const limitParam = tParams.length;
    const tasks = await this.db.query<any>(`
      WITH RECURSIVE candidates AS (
        SELECT t.project_id,t.id,t.parent_task_id,t.sort_key,
          row_number() OVER (PARTITION BY t.project_id ORDER BY t.sort_key,t.id) AS rn
        FROM v_gantt_task t WHERE ${where}
      ), page_meta AS (
        SELECT project_id,count(*) AS remaining_count,
          max(sort_key) FILTER (WHERE rn=$${limitParam}) AS last_sort,
          max(id::text) FILTER (WHERE rn=$${limitParam}) AS last_id
        FROM candidates GROUP BY project_id
      ), visible(project_id,id,parent_task_id) AS (
        SELECT project_id,id,parent_task_id FROM candidates WHERE rn <= $${limitParam}
        UNION
        SELECT t.project_id,t.id,t.parent_task_id FROM v_gantt_task t
        JOIN visible v ON t.project_id=v.project_id AND t.id=v.parent_task_id
        WHERE t.org_id=$1 AND t.project_id=ANY($2)
      )
      SELECT t.*,m.remaining_count,m.last_sort,m.last_id FROM v_gantt_task t
      JOIN visible v ON t.project_id=v.project_id AND t.id=v.id
      JOIN page_meta m ON m.project_id=t.project_id
      WHERE t.org_id=$1 ORDER BY t.project_id,t.sort_key,t.id`, tParams);
    const taskIds = tasks.map((t)=>t.id);

    // 3) 相依（批次）
    const deps = await this.db.query<any>(
      `SELECT project_id, id, predecessor_task_id, successor_task_id, relation, lag_minutes
         FROM task_dependencies
        WHERE org_id = $1 AND project_id = ANY($2) AND archived_at IS NULL
          AND (predecessor_task_id=ANY($3::uuid[]) OR successor_task_id=ANY($3::uuid[]))`,
      [ctx.orgId, ids, taskIds],
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
        id: p.id, code: p.code, name: p.name, status: p.status, health: p.health,
        permit_filing_date: p.permit_filing_date, pm_user_id: p.pm_user_id,
        task_next_cursor: null,
        task_count_remaining: 0,
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
      const project = byProject.get(t.project_id);
      project.task_count_remaining = Math.max(0, Number(t.remaining_count)-taskLimit);
      project.task_next_cursor = Number(t.remaining_count) > taskLimit
        ? Buffer.from(JSON.stringify([t.last_sort,t.last_id])).toString('base64url') : null;
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
      zoom, from: q.from ?? null, to: q.to ?? null, next_cursor: nextCursor,
      projects: projects.map((p) => byProject.get(p.id)),
    };
  }

  /** Dictionary/options are drawn only from visible projects, never from a hardcoded UI list. */
  async options(ctx: UserContext) {
    const projects = await this.db.query<any>(`SELECT p.id,p.code,p.name,p.pm_user_id
      FROM projects p WHERE p.org_id=$1 AND p.archived_at IS NULL AND ${GanttService.VISIBILITY.replaceAll('$3', '$2').replaceAll('$4', '$3')}
      ORDER BY p.code`, [ctx.orgId, ctx.userId, ctx.roles.includes('Admin')]);
    const ids = projects.map((p) => p.id);
    const [pms, resources, disciplines] = await Promise.all([
      this.db.query<any>(`SELECT id,display_name AS name FROM users WHERE org_id=$1 AND archived_at IS NULL
        AND id=ANY($2::uuid[]) ORDER BY display_name`, [ctx.orgId, projects.map((p) => p.pm_user_id).filter(Boolean)]),
      this.db.query<any>(`SELECT r.id,r.name FROM resources r WHERE r.org_id=$1 AND r.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM resource_assignments a WHERE a.org_id=r.org_id AND a.resource_id=r.id
          AND a.project_id=ANY($2::uuid[]) AND a.archived_at IS NULL) ORDER BY r.name`, [ctx.orgId,ids]),
      this.db.query<any>(`SELECT id,name FROM disciplines WHERE enabled=true ORDER BY sort_order,code`),
    ]);
    return { projects, pms, resources, disciplines };
  }

  async taskDetail(ctx: UserContext, projectId: string, taskId: string) {
    const task = await this.db.queryOne<any>(`SELECT t.*,p.name AS project_name,
        u.display_name AS owner_name,d.name AS discipline_name,
        b.baseline_start,b.baseline_finish
      FROM project_tasks t JOIN projects p ON p.org_id=t.org_id AND p.id=t.project_id
      LEFT JOIN users u ON u.org_id=t.org_id AND u.id=t.owner_user_id
      LEFT JOIN disciplines d ON d.id=t.discipline_id
      LEFT JOIN v_gantt_task b ON b.org_id=t.org_id AND b.id=t.id
      WHERE p.org_id=$1 AND p.id=$2 AND ${GanttService.VISIBILITY}
        AND p.archived_at IS NULL AND t.id=$5 AND t.archived_at IS NULL`,
      [ctx.orgId,projectId,ctx.userId,ctx.roles.includes('Admin'),taskId]);
    if (!task) throw DomainError.notFound('工作');
    const assignments = await this.db.query<any>(`SELECT a.id,a.resource_id,r.name AS resource_name,
      a.assignment_units,a.planned_work_minutes,a.assignment_start,a.assignment_finish,a.booking_type
      FROM resource_assignments a JOIN resources r ON r.org_id=a.org_id AND r.id=a.resource_id
      WHERE a.org_id=$1 AND a.project_id=$2 AND a.task_id=$3 AND a.archived_at IS NULL
      ORDER BY r.name,a.id`, [ctx.orgId,projectId,taskId]);
    // Explicit response allowlist: task detail must not leak cost or internal metadata.
    return { task: {
      id:task.id,project_id:projectId,project_name:task.project_name,wbs_code:task.wbs_code,name:task.name,
      description:task.description,status:task.status,percent_complete:Number(task.percent_complete),
      duration_minutes:task.duration_minutes,total_float_minutes:task.total_float_minutes,
      free_float_minutes:task.free_float_minutes,critical:task.critical,
      owner_name:task.owner_name,discipline_name:task.discipline_name,
      planned:{start:task.planned_start,finish:task.planned_finish},
      baseline:{start:task.baseline_start,finish:task.baseline_finish},
      actual:{start:task.actual_start,finish:task.actual_finish},
    }, assignments };
  }

  /** 單案 drill-down（跨 org 或同 org 無該案權限 → 404，不洩存在性）。 */
  async projectGantt(ctx: UserContext, projectId: string) {
    const isAdmin = ctx.roles.includes('Admin');
    const p = await this.db.queryOne<any>(
      `SELECT p.id, p.status
         FROM projects p
        WHERE p.org_id = $1 AND p.id = $2 AND p.archived_at IS NULL
          AND ${GanttService.VISIBILITY}`,
      [ctx.orgId, projectId, ctx.userId, isAdmin],
    );
    if (!p) throw DomainError.notFound('專案');
    return this.portfolio(ctx, { project_id: projectId, status: p.status } as GanttQueryDto)
      .then((r) => r.projects[0] ?? null);
  }
}
