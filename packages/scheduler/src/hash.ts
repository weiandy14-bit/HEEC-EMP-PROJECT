// =============================================================================
// 正規化雜湊：相同語意輸入 → 相同 hash（§7 T09 冪等）。
// =============================================================================

import { createHash } from 'node:crypto';
import type { ScheduleInput, ScheduledTask } from './types.ts';

/** 穩定序列化：物件鍵排序、陣列依鍵排序，去除非語意欄位順序差異。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashInput(input: ScheduleInput): string {
  const canonical = {
    anchor: input.anchor,
    statusDate: input.statusDate ?? null,
    maxNegativeLagMinutes: input.maxNegativeLagMinutes ?? null,
    calendars: [...input.calendars].sort((a, b) => a.id.localeCompare(b.id)),
    tasks: [...input.tasks].sort((a, b) => a.id.localeCompare(b.id)),
    dependencies: [...input.dependencies].sort((a, b) =>
      (a.predecessorId + a.successorId + a.relation).localeCompare(
        b.predecessorId + b.successorId + b.relation,
      ),
    ),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

export function hashResult(tasks: ScheduledTask[]): string {
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(stableStringify(sorted)).digest('hex');
}
