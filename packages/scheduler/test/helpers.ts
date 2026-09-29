// 測試輔助：標準台北日曆與時間換算。
import type { Calendar, Minute } from '../src/index.ts';

export const TZ_TAIPEI = 480; // +08:00

/** 台北本地掛鐘時間（YYYY-MM-DDTHH:mm）→ 絕對分鐘。 */
export function taipei(localIso: string): Minute {
  const utcMs = Date.parse(localIso + 'Z'); // 先當作 UTC 解析
  return utcMs / 60000 - TZ_TAIPEI;          // 再減去本地偏移得真實 UTC 分鐘
}

/** 絕對分鐘 → 台北本地 ISO（供斷言訊息）。 */
export function fromTaipei(min: Minute): string {
  const d = new Date((min + TZ_TAIPEI) * 60000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** 標準台北日曆：週一至週五 09:00–12:00、13:00–18:00（每日 8h=480 分）。 */
export function standardCalendar(id = 'CAL', exceptions?: Calendar['exceptions']): Calendar {
  const weekly = [];
  for (let wd = 1; wd <= 5; wd++) {
    weekly.push({ weekday: wd, startMinuteOfDay: 9 * 60, endMinuteOfDay: 12 * 60 });
    weekly.push({ weekday: wd, startMinuteOfDay: 13 * 60, endMinuteOfDay: 18 * 60 });
  }
  return { id, tzOffsetMinutes: TZ_TAIPEI, weekly, exceptions };
}

export const DAY = 480; // 一工作日分鐘
export const HOUR = 60;
