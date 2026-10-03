// =============================================================================
// 排程核心型別（純函式、與框架/DB 無關）
// 時間模型：內部以「自 epoch 起之絕對分鐘」表示瞬間；半開區間 [start, finish)。
// 零工期事件（milestone/anchor）為同一瞬間 start === finish。
// =============================================================================

/** 絕對分鐘（UTC epoch 起算，floor 至整分）。 */
export type Minute = number;

export type Relation = 'FS' | 'SS' | 'FF' | 'SF';

export type ConstraintType =
  | 'ASAP'
  | 'ALAP'
  | 'SNET' // Start No Earlier Than
  | 'SNLT' // Start No Later Than
  | 'FNET' // Finish No Earlier Than
  | 'FNLT' // Finish No Later Than
  | 'MSO'  // Must Start On
  | 'MFO'; // Must Finish On

export type TaskType = 'task' | 'milestone' | 'summary' | 'anchor';

/** 每週工作時段（本地時間分鐘偏移，0..1440）。 */
export interface WorkingWindow {
  /** 0=週日 .. 6=週六（對齊 DB calendar_working_days.weekday）。 */
  weekday: number;
  /** 自當日 00:00 起的本地分鐘（含）。 */
  startMinuteOfDay: number;
  /** 自當日 00:00 起的本地分鐘（不含）。 */
  endMinuteOfDay: number;
}

/** 特定日期例外：以整日「可用分鐘」與可選時段覆寫常規週模式。 */
export interface CalendarException {
  /** 本地日期 YYYY-MM-DD。 */
  localDate: string;
  /** 該日可用工作分鐘總量；0 表示假日。 */
  availableMinutes: number;
  /** 若提供，明確指定該日可用時段（否則以 availableMinutes 由日初累加）。 */
  windows?: Array<{ startMinuteOfDay: number; endMinuteOfDay: number }>;
}

/**
 * 日曆定義。為求純函式與可測試，時間換算採用「固定分鐘偏移」時區模型：
 * tzOffsetMinutes 為本地時間相對 UTC 的固定偏移（Asia/Taipei = +480）。
 * DST 時區需由呼叫端以區段化偏移前置處理（規格 §4：DST 由時區庫解算）。
 */
export interface Calendar {
  id: string;
  tzOffsetMinutes: number;
  /** 每週常規工作時段。 */
  weekly: WorkingWindow[];
  /** 日期例外（假日/加班），以 localDate 為鍵去重。 */
  exceptions?: CalendarException[];
}

/** 工作限制（限制型別 + 目標瞬間）。 */
export interface TaskConstraint {
  type: ConstraintType;
  /** 限制目標瞬間（分鐘）。ASAP/ALAP 可省略。 */
  date?: Minute;
}

/** 排入排程的工作（葉工作與錨點）。summary 由呼叫端另行彙總。 */
export interface Task {
  id: string;
  type: TaskType;
  /** 工期（工作分鐘）。milestone/anchor = 0。 */
  durationMinutes: number;
  /** 使用之日曆 id。 */
  calendarId: string;
  constraint?: TaskConstraint;
  /** 實際開始（已鎖定）。 */
  actualStart?: Minute;
  /** 實際完成（已鎖定，代表 100%）。 */
  actualFinish?: Minute;
  /**
   * 剩餘工時（工作分鐘）。用於「進行中」工作（已 actualStart、未 actualFinish）
   * 之剩餘片段預測：自 max(statusDate, actualStart) 起以剩餘工時前推完成。
   * 未提供時，進行中工作退回以全工期自 actualStart 前推（不套用狀態日）。
   */
  remainingMinutes?: Minute;
}

export interface Dependency {
  predecessorId: string;
  successorId: string;
  relation: Relation;
  lagMinutes: number;
  /** lag 換算所用日曆 id；預設後續工作日曆。 */
  lagCalendarId?: string;
}

/** 錨點：固定瞬間（掛件日）。 */
export interface Anchor {
  taskId: string;
  /** 錨點固定完成瞬間（分鐘）。 */
  instant: Minute;
}

export interface ScheduleInput {
  calendars: Calendar[];
  tasks: Task[];
  dependencies: Dependency[];
  anchor: Anchor;
  /** 狀態日：此前已完成片段固定，剩餘片段自此重排。 */
  statusDate?: Minute;
  /** 負 lag 絕對值上限（工作分鐘），預設 30 工作日 × 480。 */
  maxNegativeLagMinutes?: number;
}

export interface ScheduledTask {
  id: string;
  earlyStart: Minute;
  earlyFinish: Minute;
  lateStart: Minute;
  lateFinish: Minute;
  totalFloatMinutes: number;
  freeFloatMinutes: number;
  critical: boolean;
  /**
   * 超期關鍵（§7「若已有負浮時需標為超期關鍵」）：
   * 當已鎖定之實績（actualStart 晚於允許最晚開始、或 actualFinish 晚於允許最晚完成）
   * 使總浮時為負時為 true。此為既成事實而非可拒絕之規劃衝突，仍產出排程並標記。
   */
  overCritical: boolean;
}

export interface ScheduleConflict {
  kind:
    | 'cycle'
    | 'orphan'
    | 'negative_duration'
    | 'lag_out_of_bounds'
    | 'constraint_conflict'
    | 'anchor_conflict'
    | 'invalid_calendar';
  message: string;
  taskIds?: string[];
  edge?: { predecessorId: string; successorId: string };
}

export type ScheduleResult =
  | { ok: true; tasks: ScheduledTask[]; engineVersion: string }
  | { ok: false; conflicts: ScheduleConflict[]; engineVersion: string };

export const ENGINE_VERSION = '1.0.0';
