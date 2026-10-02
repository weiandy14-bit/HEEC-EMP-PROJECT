import { Injectable } from '@nestjs/common';
import { workingMinutesBetween, type Calendar } from '@heec/scheduler';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import { buildCalendar, type CalendarRows } from '../schedule/mapper';
import type { UserContext } from '../auth/request-context';
import type { WorkloadQueryDto } from './dto';

const TZ_MIN = 480; // Asia/Taipei 固定偏移
const DAY_MS = 86_400_000;
const toMin = (ms: number) => Math.floor(ms / 60000);

type Flag = 'over_allocated' | 'simultaneous_conflict' | 'zero_capacity' | 'on_leave';

interface Assignment {
  id: string; project_id: string; task_id: string; resource_id: string;
  assignment_units: number; planned_work_minutes: number;
  assignment_start: string | null; assignment_finish: string | null; booking_type: string;
}

/** 週邊界（Asia/Taipei 週一 00:00）之 UTC ms。 */
function weekStartUtcMs(refUtcMs: number): number {
  const wall = new Date(refUtcMs + TZ_MIN * 60000);
  const isoDow = (wall.getUTCDay() + 6) % 7; // 0=Mon
  const wallMondayMid = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - isoDow * DAY_MS;
  return wallMondayMid - TZ_MIN * 60000;
}
function isoWeekMondayUtcMs(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const wallWeek1Mon = jan4 - jan4Dow * DAY_MS;
  return wallWeek1Mon + (week - 1) * 7 * DAY_MS - TZ_MIN * 60000;
}
/** UTC 週起 → 'YYYY-Www' 標籤（以 Taipei wall-clock 計 ISO 週）。 */
function isoWeekLabel(weekStartUtcMsVal: number): string {
  const wall = new Date(weekStartUtcMsVal + TZ_MIN * 60000);
  const thursday = new Date(wall.getTime() + 3 * DAY_MS); // 週四決定年
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

@Injectable()
export class WorkloadService {
  constructor(private readonly db: DatabaseService) {}

  private calCache = new Map<string, Calendar | null>();

  private async loadCalendar(calendarId: string): Promise<Calendar | null> {
    if (this.calCache.has(calendarId)) return this.calCache.get(calendarId)!;
    const meta = await this.db.queryOne<{ id: string; timezone: string }>(
      `SELECT id, timezone FROM calendars WHERE id = $1`, [calendarId]);
    if (!meta) { this.calCache.set(calendarId, null); return null; }
    const workingDays = await this.db.query<CalendarRows['workingDays'][number]>(
      `SELECT weekday, local_start, local_end FROM calendar_working_days WHERE calendar_id = $1`, [calendarId]);
    const exceptions = await this.db.query<CalendarRows['exceptions'][number]>(
      `SELECT local_date, local_start, local_end, available_minutes FROM calendar_exceptions WHERE calendar_id = $1`, [calendarId]);
    const cal = buildCalendar({ calendar: meta, workingDays, exceptions });
    this.calCache.set(calendarId, cal);
    return cal;
  }

  /** 決定資源之日曆：resource_calendars 優先序最高，否則組織預設 active 日曆。 */
  private async resolveCalendarId(orgId: string, resourceId: string, fallback: string | null): Promise<string | null> {
    const rc = await this.db.queryOne<{ calendar_id: string }>(
      `SELECT calendar_id FROM resource_calendars
        WHERE org_id = $1 AND resource_id = $2 AND archived_at IS NULL
        ORDER BY priority DESC NULLS LAST LIMIT 1`, [orgId, resourceId]);
    return rc?.calendar_id ?? fallback;
  }

  private weeks(q: WorkloadQueryDto): { label: string; startMs: number; endMs: number }[] {
    const count = q.weeks ?? 4;
    let startMs: number;
    const m = q.from_week ? /^(\d{4})-W(\d{2})$/.exec(q.from_week) : null;
    if (m) startMs = isoWeekMondayUtcMs(Number(m[1]), Number(m[2]));
    else startMs = weekStartUtcMs(Date.now());
    const out = [];
    for (let i = 0; i < count; i++) {
      const s = startMs + i * 7 * DAY_MS;
      out.push({ label: isoWeekLabel(s), startMs: s, endMs: s + 7 * DAY_MS });
    }
    return out;
  }

  async matrix(ctx: UserContext, q: WorkloadQueryDto) {
    this.calCache.clear();
    const weeks = this.weeks(q);
    const rangeStart = weeks[0].startMs, rangeEnd = weeks[weeks.length - 1].endMs;

    const fallback = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM calendars WHERE org_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [ctx.orgId]);
    const fallbackCal = fallback?.id ?? null;

    // 可視工程師（org scope；type=labor；未封存；可選 team/resource 篩選）
    const rParams: unknown[] = [ctx.orgId];
    let rSql = `SELECT id, name, max_units, team_id, active_from, active_to
                  FROM resources
                 WHERE org_id = $1 AND type = 'labor' AND archived_at IS NULL`;
    if (q.team_id) { rParams.push(q.team_id); rSql += ` AND team_id = $${rParams.length}`; }
    if (q.resource_id) { rParams.push(q.resource_id); rSql += ` AND id = $${rParams.length}`; }
    rSql += ` ORDER BY name`;
    const resources = await this.db.query<any>(rSql, rParams);
    const ids = resources.map((r) => r.id);

    // 批次取窗內指派（committed/cover 計入需求；proposed 不計）
    const assignments = ids.length
      ? await this.db.query<Assignment>(
          `SELECT a.id, a.project_id, a.task_id, a.resource_id, a.assignment_units,
                  a.planned_work_minutes, a.assignment_start, a.assignment_finish, a.booking_type
             FROM resource_assignments a
            WHERE a.org_id = $1 AND a.resource_id = ANY($2) AND a.archived_at IS NULL
              AND a.booking_type IN ('committed','cover')
              AND a.assignment_start IS NOT NULL AND a.assignment_finish IS NOT NULL
              AND a.assignment_start < $4 AND a.assignment_finish > $3`,
          [ctx.orgId, ids, new Date(rangeStart).toISOString(), new Date(rangeEnd).toISOString()])
      : [];
    const byResource = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!byResource.has(a.resource_id)) byResource.set(a.resource_id, []);
      byResource.get(a.resource_id)!.push(a);
    }

    const outResources = [];
    for (const r of resources) {
      const calId = await this.resolveCalendarId(ctx.orgId, r.id, fallbackCal);
      const cal = calId ? await this.loadCalendar(calId) : null;
      const maxUnits = Number(r.max_units);
      const mine = byResource.get(r.id) ?? [];
      const cells = weeks.map((w) => this.cell(w, mine, cal, maxUnits, r));
      outResources.push({ resource_id: r.id, name: r.name, max_units: maxUnits, team_id: r.team_id, cells });
    }

    return {
      weeks: weeks.map((w) => w.label),
      resources: outResources,
      unassigned: await this.unassigned(ctx, rangeStart, rangeEnd),
      teamSummary: this.teamSummary(outResources, weeks),
    };
  }

  private cell(
    w: { label: string; startMs: number; endMs: number },
    assignments: Assignment[], cal: Calendar | null, maxUnits: number, resource: any,
  ) {
    const wStart = toMin(w.startMs), wEnd = toMin(w.endMs);
    // 容量 = 工作分鐘 × Max Units；在職區間外或無日曆 → 0
    let capacity = 0;
    const active = this.activeInWeek(resource, w);
    if (cal && active) capacity = Math.round(workingMinutesBetween(wStart, wEnd, cal) * maxUnits);

    // 需求：Work 依工作時間比例攤配到本週（部分投入 units 不乘入 Work）
    let demand = 0;
    const sources: any[] = [];
    const overlaps: { s: number; e: number; units: number }[] = [];
    for (const a of assignments) {
      const aS = toMin(Date.parse(a.assignment_start!));
      const aE = toMin(Date.parse(a.assignment_finish!));
      const oS = Math.max(wStart, aS), oE = Math.min(wEnd, aE);
      if (oE <= oS) continue;
      overlaps.push({ s: oS, e: oE, units: Number(a.assignment_units) });
      if (!cal) continue;
      const denom = workingMinutesBetween(aS, aE, cal);
      const num = workingMinutesBetween(oS, oE, cal);
      const contrib = denom > 0 ? (Number(a.planned_work_minutes) * num) / denom : 0;
      if (contrib > 0) {
        demand += contrib;
        sources.push({
          project_id: a.project_id, task_id: a.task_id, minutes: Math.round(contrib),
          assignment_units: Number(a.assignment_units), booking_type: a.booking_type,
        });
      }
    }
    demand = Math.round(demand);

    const flags: Flag[] = [];
    const loadRate = capacity > 0 ? demand / capacity : null;
    if (capacity === 0) { flags.push('zero_capacity'); if (demand > 0) flags.push('over_allocated'); }
    else if (demand > capacity) flags.push('over_allocated');
    // 同時投入衝突：以實際重疊時段峰值 units 判定（不同日不相加）
    if (this.peakConcurrentUnits(overlaps) > maxUnits + 1e-9) flags.push('simultaneous_conflict');
    if (cal && this.hasLeaveInWeek(cal, w)) flags.push('on_leave');

    return { week: w.label, demand_minutes: demand, capacity_minutes: capacity, load_rate: loadRate, flags, sources };
  }

  private activeInWeek(resource: any, w: { startMs: number; endMs: number }): boolean {
    const from = resource.active_from ? Date.parse(resource.active_from) : -Infinity;
    const to = resource.active_to ? Date.parse(resource.active_to) + DAY_MS : Infinity;
    return from < w.endMs && to > w.startMs;
  }

  private peakConcurrentUnits(intervals: { s: number; e: number; units: number }[]): number {
    const ev: { t: number; d: number }[] = [];
    for (const iv of intervals) { ev.push({ t: iv.s, d: iv.units }); ev.push({ t: iv.e, d: -iv.units }); }
    ev.sort((a, b) => a.t - b.t || a.d - b.d);
    let cur = 0, peak = 0;
    for (const e of ev) { cur += e.d; if (cur > peak) peak = cur; }
    return peak;
  }

  private hasLeaveInWeek(cal: Calendar, w: { startMs: number; endMs: number }): boolean {
    if (!cal.exceptions) return false;
    for (const ex of cal.exceptions) {
      if (ex.availableMinutes !== 0) continue;
      const dayWallMs = Date.parse(ex.localDate + 'T00:00:00Z'); // localDate 視為 Taipei wall
      const dayUtcMs = dayWallMs - TZ_MIN * 60000;
      if (dayUtcMs >= w.startMs && dayUtcMs < w.endMs) return true;
    }
    return false;
  }

  private async unassigned(ctx: UserContext, startMs: number, endMs: number) {
    // 未指派工作：可視進行中案件之葉工作、有工時、無任何指派、且計畫窗與範圍相交
    return this.db.query<any>(
      `SELECT t.project_id, t.id AS task_id, t.wbs_code, t.name,
              t.planned_start, t.planned_finish, t.duration_minutes
         FROM project_tasks t
         JOIN projects p ON p.org_id = t.org_id AND p.id = t.project_id
        WHERE t.org_id = $1 AND p.status = 'active' AND p.archived_at IS NULL
          AND t.archived_at IS NULL AND t.summary = false AND t.milestone = false
          AND t.duration_minutes > 0
          AND t.planned_start IS NOT NULL AND t.planned_finish IS NOT NULL
          AND t.planned_start < $3 AND t.planned_finish > $2
          AND NOT EXISTS (SELECT 1 FROM resource_assignments a
                           WHERE a.task_id = t.id AND a.archived_at IS NULL)
        ORDER BY t.planned_start LIMIT 200`,
      [ctx.orgId, new Date(startMs).toISOString(), new Date(endMs).toISOString()]);
  }

  private teamSummary(resources: any[], weeks: { label: string }[]) {
    const byTeam = new Map<string | null, Map<string, { d: number; c: number }>>();
    for (const r of resources) {
      if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, new Map());
      const wm = byTeam.get(r.team_id)!;
      for (const c of r.cells) {
        const e = wm.get(c.week) ?? { d: 0, c: 0 };
        e.d += c.demand_minutes; e.c += c.capacity_minutes; wm.set(c.week, e);
      }
    }
    return [...byTeam.entries()].map(([team_id, wm]) => ({
      team_id,
      weeks: weeks.map((w) => {
        const e = wm.get(w.label) ?? { d: 0, c: 0 };
        return { week: w.label, demand_minutes: e.d, capacity_minutes: e.c, load_rate: e.c > 0 ? e.d / e.c : null };
      }),
    }));
  }

  /** 單一工程師 drill-down（跨 org → 404）：每週每日容量/需求、假期、衝突、來源。 */
  async resourceDetail(ctx: UserContext, resourceId: string, q: WorkloadQueryDto) {
    const r = await this.db.queryOne<any>(
      `SELECT id, name, max_units, team_id, active_from, active_to
         FROM resources WHERE org_id = $1 AND id = $2 AND type = 'labor' AND archived_at IS NULL`,
      [ctx.orgId, resourceId]);
    if (!r) throw DomainError.notFound('工程師');
    const base = (await this.matrix(ctx, { ...q, resource_id: resourceId } as WorkloadQueryDto)).resources[0];
    if (!base) return null;

    // 附加每日明細（重算資源日曆與指派一次）
    this.calCache.clear();
    const weeks = this.weeks(q);
    const fallback = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM calendars WHERE org_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [ctx.orgId]);
    const calId = await this.resolveCalendarId(ctx.orgId, r.id, fallback?.id ?? null);
    const cal = calId ? await this.loadCalendar(calId) : null;
    const maxUnits = Number(r.max_units);
    const assignments = await this.db.query<Assignment>(
      `SELECT a.id, a.project_id, a.task_id, a.resource_id, a.assignment_units,
              a.planned_work_minutes, a.assignment_start, a.assignment_finish, a.booking_type
         FROM resource_assignments a
        WHERE a.org_id = $1 AND a.resource_id = $2 AND a.archived_at IS NULL
          AND a.booking_type IN ('committed','cover')
          AND a.assignment_start IS NOT NULL AND a.assignment_finish IS NOT NULL`,
      [ctx.orgId, r.id]);

    base.cells = base.cells.map((cell: any, i: number) => ({
      ...cell, days: this.days(weeks[i], assignments, cal, maxUnits, r),
    }));
    return base;
  }

  /** 週內逐日容量/需求/旗標（僅回有容量或需求之日）。 */
  private days(
    w: { startMs: number; endMs: number }, assignments: Assignment[],
    cal: Calendar | null, maxUnits: number, resource: any,
  ) {
    const out: any[] = [];
    for (let d = 0; d < 7; d++) {
      const dStartMs = w.startMs + d * DAY_MS, dEndMs = dStartMs + DAY_MS;
      const dStart = toMin(dStartMs), dEnd = toMin(dEndMs);
      const active = this.activeInWeek(resource, { startMs: dStartMs, endMs: dEndMs });
      const capacity = cal && active ? Math.round(workingMinutesBetween(dStart, dEnd, cal) * maxUnits) : 0;
      let demand = 0;
      const overlaps: { s: number; e: number; units: number }[] = [];
      for (const a of assignments) {
        const aS = toMin(Date.parse(a.assignment_start!)), aE = toMin(Date.parse(a.assignment_finish!));
        const oS = Math.max(dStart, aS), oE = Math.min(dEnd, aE);
        if (oE <= oS) continue;
        overlaps.push({ s: oS, e: oE, units: Number(a.assignment_units) });
        if (!cal) continue;
        const denom = workingMinutesBetween(aS, aE, cal);
        if (denom > 0) demand += (Number(a.planned_work_minutes) * workingMinutesBetween(oS, oE, cal)) / denom;
      }
      demand = Math.round(demand);
      if (capacity === 0 && demand === 0) continue; // 略過空白（週末/無事）
      const flags: Flag[] = [];
      if (capacity === 0) { flags.push('zero_capacity'); if (demand > 0) flags.push('over_allocated'); }
      else if (demand > capacity) flags.push('over_allocated');
      if (this.peakConcurrentUnits(overlaps) > maxUnits + 1e-9) flags.push('simultaneous_conflict');
      if (cal && this.hasLeaveInWeek(cal, { startMs: dStartMs, endMs: dEndMs })) flags.push('on_leave');
      out.push({
        date: new Date(dStartMs + TZ_MIN * 60000).toISOString().slice(0, 10),
        capacity_minutes: capacity, demand_minutes: demand,
        load_rate: capacity > 0 ? demand / capacity : null, flags,
      });
    }
    return out;
  }
}
