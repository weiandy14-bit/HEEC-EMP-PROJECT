// =============================================================================
// 相依關係界限公式（§7 關係界限）
// lag 以指定日曆換算；正 lag 前移、負 lag 後移（允許重疊，見 D06）。
// =============================================================================

import { addWorking, subtractWorking } from './calendar.ts';
import type { Calendar, Minute } from './types.ts';

/** 套用 lag（順向）：正值前移、負值後移。 */
export function applyLag(instant: Minute, lagMinutes: number, cal: Calendar): Minute {
  return lagMinutes >= 0
    ? addWorking(instant, lagMinutes, cal)
    : subtractWorking(instant, -lagMinutes, cal);
}

/** 套用 lag（逆向，用於 latest 計算）：正值後移、負值前移。 */
export function applyLagReverse(instant: Minute, lagMinutes: number, cal: Calendar): Minute {
  return lagMinutes >= 0
    ? subtractWorking(instant, lagMinutes, cal)
    : addWorking(instant, -lagMinutes, cal);
}

/**
 * 順向（earliest）：由前置之 ES/EF 求後續之下界。
 * 回傳 { startLb?, finishLb? }：對後續 start / finish 的下界（分鐘）。
 */
export function forwardBound(
  relation: string,
  predES: Minute,
  predEF: Minute,
  lagMinutes: number,
  lagCal: Calendar,
): { startLb?: Minute; finishLb?: Minute } {
  switch (relation) {
    case 'FS':
      return { startLb: applyLag(predEF, lagMinutes, lagCal) };
    case 'SS':
      return { startLb: applyLag(predES, lagMinutes, lagCal) };
    case 'FF':
      return { finishLb: applyLag(predEF, lagMinutes, lagCal) };
    case 'SF':
      return { finishLb: applyLag(predES, lagMinutes, lagCal) };
    default:
      throw new Error(`unknown relation ${relation}`);
  }
}

/**
 * 逆向（latest）：由後續之 LS/LF 求前置之上界。
 * 回傳 { startUb?, finishUb? }：對前置 start / finish 的上界（分鐘）。
 */
export function backwardBound(
  relation: string,
  succLS: Minute,
  succLF: Minute,
  lagMinutes: number,
  lagCal: Calendar,
): { startUb?: Minute; finishUb?: Minute } {
  switch (relation) {
    case 'FS':
      return { finishUb: applyLagReverse(succLS, lagMinutes, lagCal) };
    case 'SS':
      return { startUb: applyLagReverse(succLS, lagMinutes, lagCal) };
    case 'FF':
      return { finishUb: applyLagReverse(succLF, lagMinutes, lagCal) };
    case 'SF':
      return { startUb: applyLagReverse(succLF, lagMinutes, lagCal) };
    default:
      throw new Error(`unknown relation ${relation}`);
  }
}
