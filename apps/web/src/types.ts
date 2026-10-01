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
