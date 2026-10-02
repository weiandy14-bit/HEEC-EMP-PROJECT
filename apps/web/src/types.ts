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
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  milestones: GanttMilestone[];
  /** 部分資料降級（U5）：該案聚合失敗時由上層標記。 */
  error?: boolean;
}

export interface GanttResponse {
  zoom: Zoom;
  from: string | null;
  to: string | null;
  next_cursor: string | null;
  projects: GanttProject[];
}

export interface GanttFilters {
  zoom: Zoom;
  pm_id?: string;
  discipline?: string;
}

// ── 頁 C 工程師負荷 ──
export type LoadFlag = 'over_allocated' | 'simultaneous_conflict' | 'zero_capacity' | 'on_leave';

export interface WorkloadSource {
  project_id: string;
  task_id: string;
  minutes: number;
  assignment_units: number;
  booking_type: string;
}

export interface WorkloadDay {
  date: string;
  capacity_minutes: number;
  demand_minutes: number;
  load_rate: number | null;
  flags: LoadFlag[];
}

export interface WorkloadCell {
  week: string;
  demand_minutes: number;
  capacity_minutes: number;
  load_rate: number | null;
  flags: LoadFlag[];
  sources: WorkloadSource[];
  days?: WorkloadDay[]; // 僅 drill-down 回傳
}

export interface WorkloadResource {
  resource_id: string;
  name: string;
  max_units: number;
  team_id: string | null;
  cells: WorkloadCell[];
}

export interface WorkloadUnassigned {
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
  weeks: string[];
  resources: WorkloadResource[];
  unassigned: WorkloadUnassigned[];
  teamSummary: TeamSummaryRow[];
}

export interface WorkloadFilters {
  from_week?: string;
  team_id?: string;
  resource_id?: string;
}

// ── 頁 B 本週重要事項 ──
export type WeeklyType = '交圖' | '送審' | '補正' | '會議';

export interface WeeklyItem {
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
  weekStart: string;
  weekEnd: string;
  items: WeeklyItem[];
}

export interface WeeklyBoardFilters {
  week: string; // prev | this | next | YYYY-Www
  type?: WeeklyType;
  assignee?: string;
}
