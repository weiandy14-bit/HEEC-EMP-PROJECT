export type Zoom = 'day' | 'week' | 'month';

export interface Bar { start: string | null; finish: string | null }

export interface GanttTask {
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

export interface GanttDependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  relation: string;
  lag_minutes: number;
}

export interface GanttMilestone {
  kind: 'permit_filing' | 'review_due';
  id: string;
  name: string;
  date: string;
}

export interface GanttProject {
  id: string;
  code: string;
  name: string;
  status: string;
  health: string;
  permit_filing_date: string | null;
  pm_user_id: string | null;
  task_next_cursor?: string | null;
  task_count_remaining?: number;
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  milestones: GanttMilestone[];
  /** 部分資料降級（U5）：該案聚合失敗時由上層標記。 */
  error?: boolean;
  stale?: boolean;
}

export interface GanttResponse {
  zoom: Zoom;
  from: string | null;
  to: string | null;
  next_cursor: string | null;
  projects: GanttProject[];
}

export interface GanttOptions {
  projects: { id: string; code: string; name: string }[];
  pms: { id: string; name: string }[];
  resources: { id: string; name: string }[];
  disciplines: { id: string; name: string }[];
}
export interface GanttTaskDetail {
  task: { id: string; project_id: string; project_name: string; wbs_code: string; name: string;
    description: string | null; status: string; percent_complete: number; duration_minutes: number;
    total_float_minutes: number | null; free_float_minutes: number | null; critical: boolean;
    owner_name: string | null; discipline_name: string | null; planned: Bar; baseline: Bar; actual: Bar };
  assignments: { id: string; resource_name: string; assignment_units: number; planned_work_minutes: number; booking_type: string }[];
}
export interface GanttFilters {
  zoom: Zoom;
  project_id?: string;
  resource_id?: string;
  status?: string;
  from?: string;
  to?: string;
  pm_id?: string;
  discipline?: string;
}

// ── 頁 C 工程師負荷 ──
export type LoadFlag = 'over_allocated' | 'simultaneous_conflict' | 'zero_capacity' | 'on_leave' | 'data_missing';

export interface WorkloadSource {
  assignment_id?: string; project_name?: string; task_name?: string; wbs_code?: string;
  project_id: string;
  task_id: string;
  minutes: number;
  assignment_units: number;
  booking_type: string;
}

export interface WorkloadDay {
  conflicts?: ConflictWindow[];
  sources?: {assignment_id:string;project_name:string;wbs_code:string;task_name:string;minutes:number}[];
  date: string;
  capacity_minutes: number;
  demand_minutes: number;
  load_rate: number | null;
  flags: LoadFlag[];
}

export interface ConflictWindow { start:string; finish:string; units:number; max_units:number }
export interface WorkloadCell {
  conflicts?: ConflictWindow[];
  week: string;
  demand_minutes: number;
  capacity_minutes: number;
  load_rate: number | null;
  flags: LoadFlag[];
  sources: WorkloadSource[];
  days?: WorkloadDay[]; // 僅 drill-down 回傳
}

export interface WorkloadResource {
  error?:boolean; data_missing?:boolean;
  unplaced_sources?:{assignment_id:string;project_name:string;task_name:string;planned_work_minutes:number}[];
  resource_id: string;
  name: string;
  max_units: number;
  team_id: string | null;
  cells: WorkloadCell[];
}

export interface WorkloadUnassigned {
  total_count?:number;
  project_id: string;
  task_id: string;
  wbs_code: string;
  name: string;
  planned_start: string | null;
  planned_finish: string | null;
  duration_minutes: number;
}

export interface TeamSummaryRow {
  team_id: string | null;
  weeks: { week: string; demand_minutes: number; capacity_minutes: number; load_rate: number | null }[];
}

export interface WorkloadResponse {
  next_resource?:string|null;
  partial_errors?:{resource_id:string;message:string}[];
  weeks: string[];
  resources: WorkloadResource[];
  unassigned: WorkloadUnassigned[];
  teamSummary: TeamSummaryRow[];
}

export interface WorkloadFilters {
  project_id?:string;
  from_week?: string;
  team_id?: string;
  resource_id?: string;
}

// ── 頁 B 本週重要事項 ──
export type WeeklyType = '交圖' | '送審' | '補正' | '會議' | 'general' | 'milestone' | 'coordination' | 'internal_review' | '里程碑' | '內部審查' | '協調' | '工作';

export interface WeeklyItem {
  period_start?:string|null; period_end?:string|null;
  id: string;
  type: WeeklyType;
  title: string;
  project_id: string;
  project_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  source: { kind: string; id: string };
  due_at: string | null;
  status: string;
  overdue: boolean;
}

export interface WeeklyBoardResponse {
  project_summary?:{id:string;name:string;health:string;percent_complete:number;permit_filing_date:string|null;remaining_workdays:number|null}[];
  next_offset?:number|null;
  partial_errors?:{kind:string;message:string}[];
  weekStart: string;
  weekEnd: string;
  items: WeeklyItem[];
}

export interface WeeklyBoardFilters {
  project_id?:string; offset?:number; limit?:number;
  week: string; // prev | this | next | YYYY-Www
  type?: WeeklyType;
  assignee?: string;
}

export interface NamedOption {id:string;name:string}
export interface WeeklyOptions {projects:NamedOption[];owners:NamedOption[]}
export interface WorkloadOptions {projects:NamedOption[];resources:NamedOption[];teams:NamedOption[]}
export interface SourceDetail {kind:string;source:Record<string,string|number|null>;actions:{label:string;path:string;status:string}[]}
