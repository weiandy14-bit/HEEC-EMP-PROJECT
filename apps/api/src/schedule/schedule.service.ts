import { Injectable } from '@nestjs/common';
import {
  schedule as runScheduler,
  hashInput,
  hashResult,
  ENGINE_VERSION,
  type Calendar,
  type ScheduleInput,
} from '@heec/scheduler';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import {
  buildCalendar,
  buildDependency,
  buildTask,
  toMinute,
  type CalendarRows,
  type DepRow,
  type TaskRow,
} from './mapper';

interface ProjectRow {
  id: string;
  org_id: string;
  permit_filing_date: string | null;
  default_calendar_id: string | null;
  timezone: string;
  schedule_version: string;
}

@Injectable()
export class ScheduleService {
  constructor(private readonly db: DatabaseService) {}

  private async loadProject(ctx: UserContext, projectId: string): Promise<ProjectRow> {
    const row = await this.db.queryOne<ProjectRow>(
      `SELECT id, org_id, permit_filing_date, default_calendar_id, timezone, schedule_version
         FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.orgId, projectId],
    );
    if (!row) throw DomainError.notFound('專案');
    return row;
  }

  /** 讀取一致快照並組成排程輸入。 */
  private async buildInput(ctx: UserContext, project: ProjectRow): Promise<ScheduleInput> {
    const taskRows = await this.db.query<TaskRow>(
      `SELECT id, type, duration_minutes, calendar_id, constraint_type, constraint_date,
              actual_start, actual_finish, milestone
         FROM project_tasks
        WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL`,
      [ctx.orgId, project.id],
    );
    if (taskRows.length === 0) throw DomainError.scheduling('專案尚無工作可排程');

    const depRows = await this.db.query<DepRow>(
      `SELECT predecessor_task_id, successor_task_id, relation, lag_minutes, lag_calendar_policy
         FROM task_dependencies
        WHERE org_id = $1 AND project_id = $2 AND archived_at IS NULL`,
      [ctx.orgId, project.id],
    );

    // 蒐集用到的日曆（任務日曆 ∪ 專案預設日曆）
    const calIds = new Set<string>();
    for (const t of taskRows) if (t.calendar_id) calIds.add(t.calendar_id);
    if (project.default_calendar_id) calIds.add(project.default_calendar_id);
    if (calIds.size === 0) {
      throw DomainError.scheduling('缺少日曆：請設定專案預設日曆或任務日曆');
    }

    const calendars: Calendar[] = [];
    for (const calId of calIds) {
      const calMeta = await this.db.queryOne<{ id: string; timezone: string }>(
        `SELECT id, timezone FROM calendars WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, calId],
      );
      if (!calMeta) continue;
      const workingDays = await this.db.query<CalendarRows['workingDays'][number]>(
        `SELECT weekday, local_start, local_end FROM calendar_working_days WHERE calendar_id = $1`,
        [calId],
      );
      const exceptions = await this.db.query<CalendarRows['exceptions'][number]>(
        `SELECT local_date, local_start, local_end, available_minutes
           FROM calendar_exceptions WHERE calendar_id = $1`,
        [calId],
      );
      calendars.push(buildCalendar({ calendar: calMeta, workingDays, exceptions }));
    }

    const fallbackCal = project.default_calendar_id ?? [...calIds][0];
    const tasks = taskRows.map((t) => buildTask(t, fallbackCal));
    const dependencies = depRows.map(buildDependency);

    // 錨點：type='anchor' 之工作；掛件瞬間取 permit_filing_date 當地 18:00。
    const anchorTask = tasks.find((t) => t.type === 'anchor');
    if (!anchorTask) throw DomainError.scheduling('找不到掛件錨點（type=anchor）');
    if (!project.permit_filing_date) throw DomainError.scheduling('專案未設定掛件日 permit_filing_date');
    const anchorInstant = filingInstant(project.permit_filing_date, project.timezone);

    return {
      calendars,
      tasks,
      dependencies,
      anchor: { taskId: anchorTask.id, instant: anchorInstant },
    };
  }

  /** 執行重算並在交易內寫回（§7 schedule 偽程式碼）。 */
  async run(
    ctx: UserContext,
    projectId: string,
    opts: { expectedVersion?: number; idempotencyKey?: string; statusDate?: string },
  ) {
    // 冪等：同 key 直接回傳既有 run（T09）
    if (opts.idempotencyKey) {
      const existing = await this.db.queryOne<{ id: string; status: string; result: unknown }>(
        `SELECT id, status, result FROM schedule_runs
          WHERE project_id = $1 AND idempotency_key = $2`,
        [projectId, opts.idempotencyKey],
      );
      if (existing) return { runId: existing.id, status: existing.status, result: existing.result, idempotent: true };
    }

    const project = await this.loadProject(ctx, projectId);
    if (
      opts.expectedVersion !== undefined &&
      Number(project.schedule_version) !== opts.expectedVersion
    ) {
      throw new DomainError('conflict', 'schedule_version_mismatch', '排程版本已變更，請重新載入', undefined, 412 as any);
    }

    const input = await this.buildInput(ctx, project);
    if (opts.statusDate) input.statusDate = toMinute(opts.statusDate);

    const inputHash = hashInput(input);
    const result = runScheduler(input);

    return this.db.transaction(async (client) => {
      // 再次確認版本（一致快照 + 提交前比對）
      const cur = await client.query(
        `SELECT schedule_version FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (cur.rowCount === 0) throw DomainError.notFound('專案');
      if (
        opts.expectedVersion !== undefined &&
        Number(cur.rows[0].schedule_version) !== opts.expectedVersion
      ) {
        throw new DomainError('conflict', 'schedule_version_mismatch', '排程版本已變更', undefined, 412 as any);
      }

      if (!result.ok) {
        const runRow = await client.query(
          `INSERT INTO schedule_runs
             (org_id, project_id, input_hash, engine_version, idempotency_key, status, result, status_date, initiated_by, finished_at)
           VALUES ($1,$2,$3,$4,$5,'infeasible',$6,$7,$8, now())
           RETURNING id`,
          [
            ctx.orgId, projectId, inputHash, ENGINE_VERSION, opts.idempotencyKey ?? null,
            JSON.stringify({ conflicts: result.conflicts }),
            opts.statusDate ? new Date(input.statusDate! * 60000).toISOString() : null,
            ctx.userId,
          ],
        );
        // 不發布排程；回報衝突路徑（§7 D05）
        throw DomainError.scheduling('排程不可行，未發布', {
          conflicts: result.conflicts.map((c) => `${c.kind}:${c.message}`),
          run_id: [runRow.rows[0].id],
        });
      }

      // 寫回計畫日期（僅未完成片段；已鎖定實績不動）
      for (const t of result.tasks) {
        await client.query(
          `UPDATE project_tasks
              SET planned_start = to_timestamp($3 * 60),
                  planned_finish = to_timestamp($4 * 60),
                  total_float_minutes = $5,
                  free_float_minutes = $6,
                  critical = $7,
                  schedule_version = schedule_version + 1,
                  updated_by = $8
            WHERE org_id = $1 AND project_id = $2 AND id = $9`,
          [
            ctx.orgId, projectId, t.lateStart, t.lateFinish,
            t.totalFloatMinutes, t.freeFloatMinutes, t.critical, ctx.userId, t.id,
          ],
        );
      }

      const resultHash = hashResult(result.tasks);
      const runRow = await client.query(
        `INSERT INTO schedule_runs
           (org_id, project_id, input_hash, engine_version, idempotency_key, status,
            result_hash, result, status_date, initiated_by, finished_at)
         VALUES ($1,$2,$3,$4,$5,'succeeded',$6,$7,$8,$9, now())
         RETURNING id`,
        [
          ctx.orgId, projectId, inputHash, ENGINE_VERSION, opts.idempotencyKey ?? null,
          resultHash, JSON.stringify({ taskCount: result.tasks.length }),
          opts.statusDate ? new Date(input.statusDate! * 60000).toISOString() : null,
          ctx.userId,
        ],
      );

      // 遞增專案排程版本 + outbox（schedule.completed → dashboard.invalidate）
      await client.query(
        `UPDATE projects SET schedule_version = schedule_version + 1, updated_by = $3
           WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId, ctx.userId],
      );
      await client.query(
        `INSERT INTO job_outbox (org_id, aggregate_type, aggregate_id, type, payload)
         VALUES ($1,'project',$2,'schedule.completed',$3)`,
        [ctx.orgId, projectId, JSON.stringify({ runId: runRow.rows[0].id, resultHash })],
      );

      return {
        runId: runRow.rows[0].id,
        status: 'succeeded',
        engineVersion: ENGINE_VERSION,
        inputHash,
        resultHash,
        taskCount: result.tasks.length,
        criticalCount: result.tasks.filter((t) => t.critical).length,
      };
    });
  }

  async getRun(ctx: UserContext, runId: string) {
    const row = await this.db.queryOne(
      `SELECT id, project_id, status, engine_version, input_hash, result_hash, result,
              started_at, finished_at
         FROM schedule_runs WHERE org_id = $1 AND id = $2`,
      [ctx.orgId, runId],
    );
    if (!row) throw DomainError.notFound('排程執行');
    return row;
  }
}

/** 掛件日（date）→ 當地 18:00 之絕對分鐘。 */
function filingInstant(filingDate: string | Date, timezone: string): number {
  const dateStr =
    typeof filingDate === 'string' ? filingDate.slice(0, 10) : filingDate.toISOString().slice(0, 10);
  // 以當地 18:00 作為掛件事件瞬間（可由設定調整）
  const asUtc = Date.parse(`${dateStr}T18:00:00Z`);
  const offset = tzOffsetForDate(timezone, new Date(asUtc));
  return Math.floor(asUtc / 60000) - offset;
}

function tzOffsetForDate(timezone: string, ref: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    });
    const part = dtf.formatToParts(ref).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+8';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 480;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return 480;
  }
}
