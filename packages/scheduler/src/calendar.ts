// =============================================================================
// 工作時間引擎（純函式）
// 內部：絕對分鐘（UTC epoch 起算）；本地時間 = UTC + tzOffsetMinutes。
// 提供 addWorking / subtractWorking / workingMinutesBetween / 邊界對齊。
// =============================================================================

import type { Calendar, Minute } from './types.ts';

const MIN_PER_DAY = 1440;
const MAX_DAYS_SCAN = 366 * 20; // 防呆：日曆無工作時段時避免無限迴圈（約 20 年）

interface Window {
  start: number; // minute-of-day 含
  end: number;   // minute-of-day 不含
}

interface LocalParts {
  dayIndex: number;   // 自 epoch 之本地日序
  minuteOfDay: number;
  weekday: number;    // 0=週日..6=週六
  dateStr: string;    // YYYY-MM-DD
}

/** 1970-01-01 為週四；weekday 0=週日 → (dayIndex + 4) mod 7。 */
function weekdayOf(dayIndex: number): number {
  return (((dayIndex + 4) % 7) + 7) % 7;
}

function dayIndexToDateStr(dayIndex: number): string {
  // dayIndex*一日毫秒 → UTC 午夜；以 UTC 取年月日（不受主機時區影響）。
  const d = new Date(dayIndex * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalParts(absMinute: Minute, cal: Calendar): LocalParts {
  const local = absMinute + cal.tzOffsetMinutes;
  const dayIndex = Math.floor(local / MIN_PER_DAY);
  const minuteOfDay = local - dayIndex * MIN_PER_DAY;
  return {
    dayIndex,
    minuteOfDay,
    weekday: weekdayOf(dayIndex),
    dateStr: dayIndexToDateStr(dayIndex),
  };
}

function localToAbs(dayIndex: number, minuteOfDay: number, cal: Calendar): Minute {
  return dayIndex * MIN_PER_DAY + minuteOfDay - cal.tzOffsetMinutes;
}

function normalizeWindows(raw: Window[]): Window[] {
  const sorted = raw
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/** 取得某本地日之工作時段（套用例外）。 */
function windowsForDay(cal: Calendar, dateStr: string, weekday: number): Window[] {
  const ex = cal.exceptions?.find((e) => e.localDate === dateStr);
  if (ex) {
    if (ex.windows && ex.windows.length > 0) {
      return normalizeWindows(
        ex.windows.map((w) => ({ start: w.startMinuteOfDay, end: w.endMinuteOfDay })),
      );
    }
    if (ex.availableMinutes === 0) return []; // 假日
    // availableMinutes>0 但未指定時段：視為沿用常規週模式（例如補班日）
  }
  return normalizeWindows(
    cal.weekly
      .filter((w) => w.weekday === weekday)
      .map((w) => ({ start: w.startMinuteOfDay, end: w.endMinuteOfDay })),
  );
}

/** 最小的工作瞬間 >= t（若 t 已在工作時段內則回傳 t）。 */
export function snapForward(t: Minute, cal: Calendar): Minute {
  let { dayIndex, minuteOfDay } = toLocalParts(t, cal);
  for (let scan = 0; scan < MAX_DAYS_SCAN; scan++) {
    const wins = windowsForDay(cal, dayIndexToDateStr(dayIndex), weekdayOf(dayIndex));
    for (const w of wins) {
      if (minuteOfDay < w.start) return localToAbs(dayIndex, w.start, cal);
      if (minuteOfDay < w.end) return localToAbs(dayIndex, minuteOfDay, cal);
    }
    dayIndex += 1;
    minuteOfDay = 0;
  }
  throw new Error(`invalid_calendar:${cal.id}:no working time forward`);
}

/** 最大的工作結束邊界 <= t（t 作為完成邊界，半開區間右端）。 */
export function snapBackward(t: Minute, cal: Calendar): Minute {
  let { dayIndex, minuteOfDay } = toLocalParts(t, cal);
  for (let scan = 0; scan < MAX_DAYS_SCAN; scan++) {
    const wins = windowsForDay(cal, dayIndexToDateStr(dayIndex), weekdayOf(dayIndex));
    for (let i = wins.length - 1; i >= 0; i--) {
      const w = wins[i];
      if (minuteOfDay > w.end) return localToAbs(dayIndex, w.end, cal);
      if (minuteOfDay > w.start) return localToAbs(dayIndex, minuteOfDay, cal);
    }
    dayIndex -= 1;
    minuteOfDay = MIN_PER_DAY;
  }
  throw new Error(`invalid_calendar:${cal.id}:no working time backward`);
}

/** 自 t 起前移 m 個工作分鐘，回傳完成瞬間。m=0 回傳對齊後之工作瞬間。 */
export function addWorking(t: Minute, m: Minute, cal: Calendar): Minute {
  if (m < 0) throw new Error('addWorking: negative minutes');
  const start = snapForward(t, cal);
  if (m === 0) return start;
  let { dayIndex, minuteOfDay } = toLocalParts(start, cal);
  let remaining = m;
  for (let scan = 0; scan < MAX_DAYS_SCAN; scan++) {
    const wins = windowsForDay(cal, dayIndexToDateStr(dayIndex), weekdayOf(dayIndex));
    for (const w of wins) {
      if (w.end <= minuteOfDay) continue;
      const from = Math.max(w.start, minuteOfDay);
      const avail = w.end - from;
      if (remaining <= avail) return localToAbs(dayIndex, from + remaining, cal);
      remaining -= avail;
    }
    dayIndex += 1;
    minuteOfDay = 0;
  }
  throw new Error(`invalid_calendar:${cal.id}:cannot consume ${m} minutes forward`);
}

/** 自 t 起後移 m 個工作分鐘，回傳開始瞬間。m=0 回傳對齊後之結束邊界。 */
export function subtractWorking(t: Minute, m: Minute, cal: Calendar): Minute {
  if (m < 0) throw new Error('subtractWorking: negative minutes');
  const end = snapBackward(t, cal);
  if (m === 0) return end;
  let { dayIndex, minuteOfDay } = toLocalParts(end, cal);
  let remaining = m;
  for (let scan = 0; scan < MAX_DAYS_SCAN; scan++) {
    const wins = windowsForDay(cal, dayIndexToDateStr(dayIndex), weekdayOf(dayIndex));
    for (let i = wins.length - 1; i >= 0; i--) {
      const w = wins[i];
      if (w.start >= minuteOfDay) continue;
      const to = Math.min(w.end, minuteOfDay);
      const avail = to - w.start;
      if (remaining <= avail) return localToAbs(dayIndex, to - remaining, cal);
      remaining -= avail;
    }
    dayIndex -= 1;
    minuteOfDay = MIN_PER_DAY;
  }
  throw new Error(`invalid_calendar:${cal.id}:cannot consume ${m} minutes backward`);
}

/** [a, b) 之間的工作分鐘總量（要求 a <= b）。 */
export function workingMinutesBetween(a: Minute, b: Minute, cal: Calendar): Minute {
  if (b <= a) return 0;
  let { dayIndex } = toLocalParts(a, cal);
  const endParts = toLocalParts(b, cal);
  let total = 0;
  for (let scan = 0; scan <= endParts.dayIndex - toLocalParts(a, cal).dayIndex && scan < MAX_DAYS_SCAN; scan++) {
    const wins = windowsForDay(cal, dayIndexToDateStr(dayIndex), weekdayOf(dayIndex));
    for (const w of wins) {
      const winStartAbs = localToAbs(dayIndex, w.start, cal);
      const winEndAbs = localToAbs(dayIndex, w.end, cal);
      const lo = Math.max(a, winStartAbs);
      const hi = Math.min(b, winEndAbs);
      if (hi > lo) total += hi - lo;
    }
    dayIndex += 1;
  }
  return total;
}

/** 計算 [a,b) 涵蓋之工作日數（用於逾期天數，見 §7 late_days）。 */
export function countWorkingDays(a: Minute, b: Minute, cal: Calendar): number {
  if (b <= a) return 0;
  const startDay = toLocalParts(a, cal).dayIndex;
  const endDay = toLocalParts(b, cal).dayIndex;
  let count = 0;
  for (let d = startDay; d <= endDay && d - startDay < MAX_DAYS_SCAN; d++) {
    const wins = windowsForDay(cal, dayIndexToDateStr(d), weekdayOf(d));
    if (wins.length > 0) count++;
  }
  return count;
}
