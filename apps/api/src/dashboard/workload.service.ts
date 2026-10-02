import { Injectable } from '@nestjs/common';
import { workingMinutesBetween, workingIntervalsBetween, type Calendar } from '@heec/scheduler';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import { buildCalendar, type CalendarRows } from '../schedule/mapper';
import type { UserContext } from '../auth/request-context';
import type { WorkloadQueryDto } from './dto';
import { isoWeekStart } from './week';

const TZ_MIN = 480; // Asia/Taipei 固定偏移
// Same project visibility contract as GanttService. Always combine with org scope.
const PROJECT_VISIBILITY = `( $5::boolean OR p.created_by = $6 OR p.pm_user_id = $6
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.org_id = p.org_id
    AND m.project_id = p.id AND m.user_id = $6 AND m.archived_at IS NULL) )`;
const DAY_MS = 86_400_000;
const toMin = (ms: number) => Math.floor(ms / 60000);

type Flag = 'over_allocated' | 'simultaneous_conflict' | 'zero_capacity' | 'on_leave' | 'data_missing';

interface Assignment {
  id: string; project_id: string; task_id: string; resource_id: string;
  assignment_units: number; planned_work_minutes: number;
  assignment_start: string | null; assignment_finish: string | null; booking_type: string;
  project_name: string; task_name: string; wbs_code: string; contour: any;
}

/** 週邊界（Asia/Taipei 週一 00:00）之 UTC ms。 */
function weekStartUtcMs(refUtcMs: number): number {
  const wall = new Date(refUtcMs + TZ_MIN * 60000);
  const isoDow = (wall.getUTCDay() + 6) % 7; // 0=Mon
  const wallMondayMid = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - isoDow * DAY_MS;
  return wallMondayMid - TZ_MIN * 60000;
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
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  /** CSV uses the same scoped live query as the matrix; no client-provided rows. */
  async exportCsv(ctx: UserContext, q: WorkloadQueryDto, correlationId?: string) {
    const data = await this.matrix(ctx, {...q,after_resource:undefined,limit:500});
    let after=data.next_resource;
    while(after){const page=await this.matrix(ctx,{...q,after_resource:after,limit:500});data.resources.push(...page.resources);after=page.next_resource;}
    data.teamSummary=this.teamSummary(data.resources,data.weeks.map(label=>({label})));
    const quote = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const rows: unknown[][] = [['type', 'resource_id', 'name', 'team_id', 'week', 'demand_minutes', 'capacity_minutes', 'load_rate', 'flags']];
    for (const r of data.resources) for (const c of r.cells) {
      rows.push(['resource', r.resource_id, r.name, r.team_id, c.week, c.demand_minutes, c.capacity_minutes, c.load_rate, c.flags.join('|')]);
    }
    for (const t of data.teamSummary) for (const c of t.weeks) {
      rows.push(['team', '', '', t.team_id, c.week, c.demand_minutes, c.capacity_minutes, c.load_rate, '']);
    }
    await this.db.transaction((client) => this.audit.write(client, ctx, {
      entityType: 'dashboard_workload', action: 'export', correlationId,
      diff: { filters: { ...q }, resource_count: data.resources.length, row_count: rows.length - 1 },
    }));
    return '\ufeff' + rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
  }

  private async loadCalendar(calendarId: string): Promise<Calendar | null> {
    const [metas,workingDays,exceptions] = await Promise.all([
      this.db.query<any>(`SELECT id,timezone FROM calendars WHERE id=$1`,[calendarId]),
      this.db.query<CalendarRows['workingDays'][number]>(`SELECT weekday,local_start,local_end FROM calendar_working_days WHERE calendar_id=$1`,[calendarId]),
      this.db.query<CalendarRows['exceptions'][number]>(`SELECT local_date,local_start,local_end,available_minutes FROM calendar_exceptions WHERE calendar_id=$1`,[calendarId])]);
    return metas[0] ? buildCalendar({calendar:metas[0],workingDays,exceptions}) : null;
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
    if (m) startMs = isoWeekStart(q.from_week!);
    else startMs = weekStartUtcMs(Date.now());
    const out = [];
    for (let i = 0; i < count; i++) {
      const s = startMs + i * 7 * DAY_MS;
      out.push({ label: isoWeekLabel(s), startMs: s, endMs: s + 7 * DAY_MS });
    }
    return out;
  }

  async matrix(ctx: UserContext, q: WorkloadQueryDto) {
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
    if (q.after_resource) { rParams.push(q.after_resource); rSql += ` AND id > $${rParams.length}`; }
    rParams.push(q.limit ?? 500); rSql += ` ORDER BY id LIMIT $${rParams.length}`;
    const resources = await this.db.query<any>(rSql, rParams);
    const ids = resources.map((r) => r.id);

    // 批次取窗內指派（committed/cover 計入需求；proposed 不計）
    const assignments = ids.length
      ? await this.db.query<Assignment>(
          `SELECT a.id, a.project_id, a.task_id, a.resource_id, a.assignment_units,
                  a.planned_work_minutes, a.assignment_start, a.assignment_finish, a.booking_type, a.contour, p.name AS project_name, t.name AS task_name, t.wbs_code
             FROM resource_assignments a
             JOIN projects p ON p.org_id = a.org_id AND p.id = a.project_id
             JOIN project_tasks t ON t.org_id=a.org_id AND t.project_id=a.project_id AND t.id=a.task_id AND t.archived_at IS NULL
            WHERE p.archived_at IS NULL AND ${PROJECT_VISIBILITY} AND a.org_id = $1 AND a.resource_id = ANY($2) AND a.archived_at IS NULL
              AND ($7::uuid IS NULL OR a.project_id=$7) AND a.booking_type IN ('committed','cover')
              AND a.assignment_start IS NOT NULL AND a.assignment_finish IS NOT NULL
              AND a.assignment_start < $4 AND a.assignment_finish > $3`,
          [ctx.orgId, ids, new Date(rangeStart).toISOString(), new Date(rangeEnd).toISOString(), ctx.roles.includes('Admin'), ctx.userId, q.project_id ?? null])
      : [];
    const byResource = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!byResource.has(a.resource_id)) byResource.set(a.resource_id, []);
      byResource.get(a.resource_id)!.push(a);
    }

    // Six calendar queries at most, independent of resource count; maps live only inside this request.
    const [links,metas,working,exceptions] = await Promise.all([
      this.db.query<any>(`SELECT DISTINCT ON(resource_id) resource_id,calendar_id FROM resource_calendars WHERE org_id=$1 AND resource_id=ANY($2::uuid[]) AND archived_at IS NULL ORDER BY resource_id,priority DESC NULLS LAST,calendar_id`,[ctx.orgId,ids]),
      this.db.query<any>(`SELECT id,timezone FROM calendars WHERE org_id=$1 AND archived_at IS NULL`,[ctx.orgId]),
      this.db.query<any>(`SELECT w.* FROM calendar_working_days w JOIN calendars c ON c.id=w.calendar_id WHERE c.org_id=$1 AND w.archived_at IS NULL`,[ctx.orgId]),
      this.db.query<any>(`SELECT e.* FROM calendar_exceptions e JOIN calendars c ON c.id=e.calendar_id WHERE c.org_id=$1 AND e.archived_at IS NULL`,[ctx.orgId]),
    ]);
    const calendars = new Map<string,Calendar>(), broken = new Set<string>();
    for(const meta of metas)try {calendars.set(meta.id,buildCalendar({calendar:meta,workingDays:working.filter(w=>w.calendar_id===meta.id),exceptions:exceptions.filter(e=>e.calendar_id===meta.id)}));}catch(error){console.error('dashboard.calendar.invalid',{id:meta.id,error});broken.add(meta.id);}
    const linksByResource=new Map(links.map(r=>[r.resource_id,r.calendar_id]));
    const outResources = resources.map(r=>{
      const calId=linksByResource.get(r.id)??fallbackCal;
      const cal=calId?calendars.get(calId)??null:null;
      const maxUnits=Number(r.max_units),mine=byResource.get(r.id)??[];
      return {resource_id:r.id,name:r.name,max_units:maxUnits,team_id:r.team_id,
        error:!!calId && broken.has(calId),data_missing:!cal,
        cells:weeks.map(w=>this.cell(w,mine,cal,maxUnits,r))};
    });

    return {
      weeks: weeks.map((w) => w.label),
      resources: outResources,
      unassigned: await this.unassigned(ctx, rangeStart, rangeEnd,q.project_id,q.unassigned_offset??0),
      teamSummary: this.teamSummary(outResources, weeks),
      next_resource: resources.length === (q.limit ?? 500) ? resources[resources.length-1].id : null,
      partial_errors: outResources.filter(r=>r.error).map(r=>({resource_id:r.resource_id,message:'日曆資料無法計算'})),
    };
  }


  private capacity(start:number,end:number,cal:Calendar,max:number,r:any) {
    const from=r.active_from?toMin(Date.parse(r.active_from+'T00:00:00+08:00')):-Infinity;
    const to=r.active_to?toMin(Date.parse(r.active_to+'T00:00:00+08:00')+DAY_MS):Infinity;
    return Math.round(workingMinutesBetween(Math.max(start,from),Math.min(end,to),cal)*max);
  }
  private validContour(a:Assignment):boolean {
    if(a.contour==null)return true;
    if(!Array.isArray(a.contour) || !a.contour.length)return false;
    let total=0,last=-Infinity;
    for(const s of a.contour){const start=Date.parse(s.start),finish=Date.parse(s.finish);
      if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<=start||start<last||start<Date.parse(a.assignment_start!)||finish>Date.parse(a.assignment_finish!)||!Number.isInteger(s.work_minutes)||s.work_minutes<0)return false;
      total+=s.work_minutes;last=finish;
    }
    return total===Number(a.planned_work_minutes);
  }
  private contribution(a:Assignment,start:number,end:number,cal:Calendar|null):number {
    const segments=this.validContour(a) && a.contour?a.contour:[{start:a.assignment_start,finish:a.assignment_finish,work_minutes:Number(a.planned_work_minutes)}];
    let total=0;
    for(const segment of segments){
      const s=toMin(Date.parse(segment.start!)),e=toMin(Date.parse(segment.finish!));
      if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s||e<=start||s>=end)continue;
      const denom=cal?workingMinutesBetween(s,e,cal):0;
      const cumulative=(t:number)=>{const bound=Math.max(s,Math.min(e,t));return denom>0?workingMinutesBetween(s,bound,cal!)/denom:(bound-s)/(e-s);};
      total+=Math.round(segment.work_minutes*cumulative(end))-Math.round(segment.work_minutes*cumulative(start));
    }
    return total;
  }
  private conflicts(intervals:{s:number;e:number;units:number}[],cal:Calendar|null,max:number){
    if(!cal)return [];
    const points=[...new Set(intervals.flatMap(i=>[i.s,i.e]))].sort((a,b)=>a-b),out:any[]=[];
    for(let i=0;i<points.length-1;i++){
      const s=points[i],e=points[i+1],units=intervals.filter(v=>v.s<=s && v.e>=e).reduce((n,v)=>n+v.units,0);
      if(units>max+1e-9)for(const window of workingIntervalsBetween(s,e,cal))out.push({start:new Date(window.start*60000).toISOString(),finish:new Date(window.end*60000).toISOString(),units,max_units:max});
    }
    return out;
  }
  async options(ctx:UserContext){
    const [resources,teams,projects]=await Promise.all([
      this.db.query(`SELECT id,name FROM resources WHERE org_id=$1 AND type='labor' AND archived_at IS NULL ORDER BY name`,[ctx.orgId]),
      this.db.query(`SELECT id,name FROM teams WHERE org_id=$1 AND archived_at IS NULL ORDER BY name`,[ctx.orgId]),
      this.db.query(`SELECT p.id,p.name FROM projects p WHERE p.org_id=$1 AND p.archived_at IS NULL AND ($2::boolean OR p.created_by=$3 OR p.pm_user_id=$3 OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$3 AND m.archived_at IS NULL)) ORDER BY name`,[ctx.orgId,ctx.roles.includes('Admin'),ctx.userId])]);
    return {resources,teams,projects};
  }

  private cell(
    w: { label: string; startMs: number; endMs: number },
    assignments: Assignment[], cal: Calendar | null, maxUnits: number, resource: any,
  ) {
    const wStart = toMin(w.startMs), wEnd = toMin(w.endMs);
    // 容量 = 工作分鐘 × Max Units；在職區間外或無日曆 → 0
    let capacity = 0;
    const active = this.activeInWeek(resource, w);
    if (cal && active) capacity = this.capacity(wStart,wEnd,cal,maxUnits,resource);

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
      const contrib = this.contribution(a,oS,oE,cal);
      if (contrib > 0) {
        demand += contrib;
        sources.push({
          assignment_id:a.id, project_id: a.project_id, project_name:a.project_name, task_id: a.task_id, task_name:a.task_name, wbs_code:a.wbs_code, minutes: Math.round(contrib),
          assignment_units: Number(a.assignment_units), booking_type: a.booking_type,
        });
      }
    }
    demand = Math.round(demand);

    const flags: Flag[] = [];
    if(!cal || assignments.some(a=>!this.validContour(a))) flags.push('data_missing');
    const conflicts=this.conflicts(overlaps,cal,maxUnits);
    const loadRate = capacity > 0 ? demand / capacity : null;
    if (capacity === 0) { flags.push('zero_capacity'); if (demand > 0) flags.push('over_allocated'); }
    else if (demand > capacity) flags.push('over_allocated');
    // 同時投入衝突：以實際重疊時段峰值 units 判定（不同日不相加）
    if (this.conflicts(overlaps,cal,maxUnits).length) flags.push('simultaneous_conflict');
    if (cal && this.hasLeaveInWeek(cal, w)) flags.push('on_leave');

    return { week: w.label, demand_minutes: demand, capacity_minutes: capacity, load_rate: loadRate, flags, sources, conflicts };
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

  private async unassigned(ctx: UserContext, startMs: number, endMs: number, projectId?:string,offset=0) {
    // 未指派工作：可視進行中案件之葉工作、有工時、無任何指派、且計畫窗與範圍相交
    return this.db.query<any>(
      `SELECT count(*) OVER() AS total_count,t.project_id, t.id AS task_id, t.wbs_code, t.name,
              t.planned_start, t.planned_finish, t.duration_minutes
         FROM project_tasks t
         JOIN projects p ON p.org_id = t.org_id AND p.id = t.project_id
        WHERE t.org_id = $1 AND p.status = 'active' AND p.archived_at IS NULL
          AND t.archived_at IS NULL AND t.summary = false AND t.milestone = false
          AND ${PROJECT_VISIBILITY.replaceAll('$5', '$4').replaceAll('$6', '$5')}
          AND ($6::uuid IS NULL OR t.project_id=$6) AND t.duration_minutes > 0
          AND t.planned_start IS NOT NULL AND t.planned_finish IS NOT NULL
          AND t.planned_start < $3 AND t.planned_finish > $2
          AND NOT EXISTS (SELECT 1 FROM resource_assignments a
                           WHERE a.task_id = t.id AND a.archived_at IS NULL)
        ORDER BY t.planned_start,t.id LIMIT 200 OFFSET $7`,
      [ctx.orgId, new Date(startMs).toISOString(), new Date(endMs).toISOString(), ctx.roles.includes('Admin'), ctx.userId, projectId??null,offset]);
  }

  async unassignedPage(ctx:UserContext,q:WorkloadQueryDto){const weeks=this.weeks(q);return {items:await this.unassigned(ctx,weeks[0].startMs,weeks[weeks.length-1].endMs,q.project_id,q.unassigned_offset??0)};}

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
    const base = (await this.matrix(ctx, { ...q, after_resource:undefined, resource_id: resourceId } as WorkloadQueryDto)).resources[0];
    if (!base) return null;

    // 附加每日明細（重算資源日曆與指派一次）
    const weeks = this.weeks(q);
    const fallback = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM calendars WHERE org_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [ctx.orgId]);
    const calId = await this.resolveCalendarId(ctx.orgId, r.id, fallback?.id ?? null);
    const cal = calId ? await this.loadCalendar(calId) : null;
    const maxUnits = Number(r.max_units);
    const assignments = await this.db.query<Assignment>(
      `SELECT a.id, a.project_id, a.task_id, a.resource_id, a.assignment_units,
              a.planned_work_minutes, a.assignment_start, a.assignment_finish, a.booking_type, a.contour, p.name AS project_name, t.name AS task_name, t.wbs_code
         FROM resource_assignments a
         JOIN projects p ON p.org_id = a.org_id AND p.id = a.project_id
             JOIN project_tasks t ON t.org_id=a.org_id AND t.project_id=a.project_id AND t.id=a.task_id AND t.archived_at IS NULL
        WHERE p.archived_at IS NULL AND ${PROJECT_VISIBILITY} AND a.org_id = $1 AND a.resource_id = $2 AND a.archived_at IS NULL
          AND ($7::uuid IS NULL OR a.project_id=$7) AND a.booking_type IN ('committed','cover')
          AND a.assignment_start IS NOT NULL AND a.assignment_finish IS NOT NULL
          AND a.assignment_start < $4 AND a.assignment_finish > $3`,
      [ctx.orgId, r.id, new Date(weeks[0].startMs).toISOString(),
       new Date(weeks[weeks.length - 1].endMs).toISOString(), ctx.roles.includes('Admin'), ctx.userId, q.project_id ?? null]);

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
      const capacity = cal && active ? this.capacity(dStart,dEnd,cal,maxUnits,resource) : 0;
      let demand = 0;
      const overlaps: { s: number; e: number; units: number }[] = [];
      for (const a of assignments) {
        const aS = toMin(Date.parse(a.assignment_start!)), aE = toMin(Date.parse(a.assignment_finish!));
        const oS = Math.max(dStart, aS), oE = Math.min(dEnd, aE);
        if (oE <= oS) continue;
        overlaps.push({ s: oS, e: oE, units: Number(a.assignment_units) });
        demand += this.contribution(a,oS,oE,cal);
      }
      demand = Math.round(demand);
      const onLeave = !!cal && this.hasLeaveInWeek(cal, { startMs: dStartMs, endMs: dEndMs });
      // Preserve leave/zero-unit and missing-calendar days; ordinary nonworking days can be omitted.
      if (capacity === 0 && demand === 0 && !onLeave && cal && maxUnits > 0) continue;
      const flags: Flag[] = [];
      if (capacity === 0) { flags.push('zero_capacity'); if (demand > 0) flags.push('over_allocated'); }
      else if (demand > capacity) flags.push('over_allocated');
      if (this.conflicts(overlaps,cal,maxUnits).length) flags.push('simultaneous_conflict');
      if (onLeave) flags.push('on_leave');
      out.push({
        date: new Date(dStartMs + TZ_MIN * 60000).toISOString().slice(0, 10),
        capacity_minutes: capacity, demand_minutes: demand,
        load_rate: capacity > 0 ? demand / capacity : null, flags,
        sources:assignments.filter(a=>Date.parse(a.assignment_start!)<dEndMs && Date.parse(a.assignment_finish!)>dStartMs).map(a=>({assignment_id:a.id,project_name:a.project_name,wbs_code:a.wbs_code,task_name:a.task_name,minutes:this.contribution(a,dStart,dEnd,cal)})),
        conflicts:this.conflicts(overlaps,cal,maxUnits),
      });
    }
    return out;
  }
}
