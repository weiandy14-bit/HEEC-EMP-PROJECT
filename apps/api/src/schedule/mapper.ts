import type {
  Calendar,
  ConstraintType,
  Dependency,
  Task,
  TaskType,
} from '@heec/scheduler';
import { DomainError } from '../common/errors';

/** timestamptz 字串 → 絕對分鐘（UTC epoch 起算）。 */
export function toMinute(ts: string | Date | null | undefined): number | undefined {
  if (ts == null) return undefined;
  const ms = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 60000);
}

/** 由 IANA 時區求固定分鐘偏移（不含 DST；台北 +480）。 */
export function tzOffsetMinutes(timezone: string, ref = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    });
    const part = dtf.formatToParts(ref).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+8';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (part === 'GMT' || part === 'UTC') return 0;
    if (!m) throw new Error('Unsupported timezone offset');
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    throw DomainError.validation('工作日曆時區無效');
  }
}

/** HH:MM:SS 或分鐘 → 當日分鐘偏移。 */
function timeToMinuteOfDay(t: string): number {
  const [h, mi] = t.split(':');
  return Number(h) * 60 + Number(mi ?? 0);
}

export interface CalendarRows {
  calendar: { id: string; timezone: string };
  workingDays: Array<{ weekday: number; local_start: string; local_end: string }>;
  exceptions: Array<{
    local_date: string;
    local_start: string | null;
    local_end: string | null;
    available_minutes: number;
  }>;
}

export function buildCalendar(rows: CalendarRows): Calendar {
  const weekly = rows.workingDays.map((w) => ({
    weekday: w.weekday,
    startMinuteOfDay: timeToMinuteOfDay(w.local_start),
    endMinuteOfDay: timeToMinuteOfDay(w.local_end),
  }));
  const byDate = new Map<string, { availableMinutes: number; windows: any[] }>();
  for (const e of rows.exceptions) {
    const key = typeof e.local_date === 'string' ? e.local_date.slice(0, 10) : String(e.local_date);
    const entry = byDate.get(key) ?? { availableMinutes: 0, windows: [] };
    entry.availableMinutes = Math.max(entry.availableMinutes, e.available_minutes);
    if (e.local_start && e.local_end) {
      entry.windows.push({
        startMinuteOfDay: timeToMinuteOfDay(e.local_start),
        endMinuteOfDay: timeToMinuteOfDay(e.local_end),
      });
    }
    byDate.set(key, entry);
  }
  const exceptions = [...byDate.entries()].map(([localDate, v]) => ({
    localDate,
    availableMinutes: v.availableMinutes,
    windows: v.windows.length ? v.windows : undefined,
  }));
  return {
    id: rows.calendar.id,
    tzOffsetMinutes: tzOffsetMinutes(rows.calendar.timezone),
    weekly,
    exceptions,
  };
}

export interface TaskRow {
  id: string;
  type: string;
  duration_minutes: number;
  calendar_id: string | null;
  constraint_type: string;
  constraint_date: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  milestone: boolean;
}

export function buildTask(row: TaskRow, fallbackCalendarId: string): Task {
  const calendarId = row.calendar_id ?? fallbackCalendarId;
  if (!calendarId) throw DomainError.scheduling(`工作 ${row.id} 無可用日曆`);
  let type: TaskType = (['task', 'milestone', 'summary', 'anchor'] as const).includes(
    row.type as TaskType,
  )
    ? (row.type as TaskType)
    : 'task';
  if (row.milestone && type === 'task') type = 'milestone';

  const constraintType = row.constraint_type as ConstraintType;
  const constraintDate = toMinute(row.constraint_date);
  return {
    id: row.id,
    type,
    durationMinutes: row.duration_minutes,
    calendarId,
    constraint:
      constraintType && constraintType !== 'ASAP'
        ? { type: constraintType, date: constraintDate }
        : undefined,
    actualStart: toMinute(row.actual_start),
    actualFinish: toMinute(row.actual_finish),
  };
}

export interface DepRow {
  predecessor_task_id: string;
  successor_task_id: string;
  relation: string;
  lag_minutes: number;
  lag_calendar_policy: string;
}

export function buildDependency(row: DepRow): Dependency {
  return {
    predecessorId: row.predecessor_task_id,
    successorId: row.successor_task_id,
    relation: row.relation as Dependency['relation'],
    lagMinutes: row.lag_minutes,
  };
}
