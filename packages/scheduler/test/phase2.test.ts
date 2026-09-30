import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule,
  workingMinutesBetween,
  lateDays,
  type ScheduleInput,
  type Calendar,
} from '../src/index.ts';
import { standardCalendar, taipei, fromTaipei, DAY, HOUR } from './helpers.ts';

const CAL = standardCalendar();

// =============================================================================
// G2 負 lag 邊界（D06：允許負值、限制絕對值上限；超限拒絕）
// =============================================================================
test('G2 正例：負 lag 於上限內 → 可行、允許重疊', () => {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'A', type: 'task', durationMinutes: 2 * DAY, calendarId: 'CAL' },
      { id: 'B', type: 'task', durationMinutes: 2 * DAY, calendarId: 'CAL' },
    ],
    dependencies: [
      { predecessorId: 'A', successorId: 'B', relation: 'FS', lagMinutes: -DAY }, // 重疊 1 工作日
      { predecessorId: 'B', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: taipei('2027-03-01T18:00') },
    maxNegativeLagMinutes: DAY, // 上限 1 工作日
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
});

test('G2 邊界負例：負 lag 超過自訂上限 → lag_out_of_bounds', () => {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'A', type: 'task', durationMinutes: 2 * DAY, calendarId: 'CAL' },
      { id: 'B', type: 'task', durationMinutes: 2 * DAY, calendarId: 'CAL' },
    ],
    dependencies: [
      { predecessorId: 'A', successorId: 'B', relation: 'FS', lagMinutes: -(DAY + 1) },
      { predecessorId: 'B', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: taipei('2027-03-01T18:00') },
    maxNegativeLagMinutes: DAY,
  };
  const r = schedule(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'lag_out_of_bounds'));
});

test('G2 邊界負例：超過預設上限（30 工作日=14400 分） → lag_out_of_bounds', () => {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'A', type: 'task', durationMinutes: DAY, calendarId: 'CAL' },
      { id: 'B', type: 'task', durationMinutes: DAY, calendarId: 'CAL' },
    ],
    dependencies: [
      { predecessorId: 'A', successorId: 'B', relation: 'FS', lagMinutes: -(30 * DAY + 1) },
      { predecessorId: 'B', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: taipei('2027-06-01T18:00') },
  };
  const r = schedule(input);
  assert.equal(r.ok, false);
  if (!r.ok) {
    const c = r.conflicts.find((x) => x.kind === 'lag_out_of_bounds');
    assert.ok(c, '應回報 lag_out_of_bounds');
    assert.ok(c!.edge?.predecessorId === 'A' && c!.edge?.successorId === 'B');
  }
});

// =============================================================================
// G3 自由浮時（本任務延後而不推遲任一後續 earliest 的最小 slack；與總浮時區辨）
// B(1d)、C(3d) 皆 → D(1d) → ANCH；C 驅動 D，B 具自由浮時。
// =============================================================================
test('G3 free float：非驅動前置具自由浮時、驅動前置為 0', () => {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'B', type: 'task', durationMinutes: 1 * DAY, calendarId: 'CAL' },
      { id: 'C', type: 'task', durationMinutes: 3 * DAY, calendarId: 'CAL' },
      { id: 'D', type: 'task', durationMinutes: 1 * DAY, calendarId: 'CAL' },
    ],
    dependencies: [
      { predecessorId: 'B', successorId: 'D', relation: 'FS', lagMinutes: 0 },
      { predecessorId: 'C', successorId: 'D', relation: 'FS', lagMinutes: 0 },
      { predecessorId: 'D', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: taipei('2027-03-01T18:00') },
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const b = r.tasks.find((t) => t.id === 'B')!;
  const c = r.tasks.find((t) => t.id === 'C')!;
  const d = r.tasks.find((t) => t.id === 'D')!;
  // B 可延後 2 工作日（至 D 的 earliest）而不推遲 D
  assert.equal(b.freeFloatMinutes, 2 * DAY);
  assert.equal(b.freeFloatMinutes, workingMinutesBetween(b.earlyFinish, d.earlyStart, CAL));
  // C 驅動 D → 自由浮時 0
  assert.equal(c.freeFloatMinutes, 0);
  assert.equal(c.totalFloatMinutes, 0); // C 亦在關鍵鏈
  assert.equal(d.freeFloatMinutes, 0);
});

// =============================================================================
// G4 跨日曆相依（§7：跨日曆比較 UTC 事件後轉換；lag 用邊指定日曆）
// A 用台北日曆(+8, 09–12/13–18)，B 用 UTC 日曆(+0, 09–17 無午休)。
// =============================================================================
test('G4 跨日曆：後續依自身日曆銜接前置（UTC 事件比較）', () => {
  const CALU: Calendar = {
    id: 'CALU',
    tzOffsetMinutes: 0,
    weekly: [1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, startMinuteOfDay: 9 * 60, endMinuteOfDay: 17 * 60 })),
  };
  const anchorUtc = Math.floor(Date.parse('2027-03-05T12:00:00Z') / 60000);
  const input: ScheduleInput = {
    calendars: [CAL, CALU],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CALU' },
      { id: 'A', type: 'task', durationMinutes: 1 * DAY, calendarId: 'CAL' }, // 台北 8h
      { id: 'B', type: 'task', durationMinutes: 2 * HOUR, calendarId: 'CALU' }, // UTC 2h
    ],
    dependencies: [
      { predecessorId: 'A', successorId: 'B', relation: 'FS', lagMinutes: 0 }, // lag 預設用後續日曆(CALU)
      { predecessorId: 'B', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: anchorUtc },
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = r.tasks.find((t) => t.id === 'A')!;
  const b = r.tasks.find((t) => t.id === 'B')!;
  const utc = (m: number) => new Date(m * 60000).toISOString().slice(0, 16) + 'Z';
  // A 台北一個工作日完成 = 03-05 18:00 台北 = 10:00Z
  assert.equal(utc(a.earlyFinish), '2027-03-05T10:00Z');
  // B（UTC 日曆）於 A 完成之 UTC 事件銜接：10:00Z 在 CALU 工作時段內 → 直接開始
  assert.equal(utc(b.earlyStart), '2027-03-05T10:00Z');
  assert.equal(utc(b.earlyFinish), '2027-03-05T12:00Z');
  // FS 界限成立：B 開始不早於 A 完成（同一 UTC 瞬間）
  assert.ok(b.earlyStart >= a.earlyFinish);
});

// =============================================================================
// G6 statusDate 進行中重排（剩餘片段自 max(statusDate, actualStart) 前推；開始鎖定）
// =============================================================================
test('G6 正例：進行中工作開始鎖定、剩餘自狀態日重排', () => {
  const actualStart = taipei('2027-02-01T09:00');
  const statusDate = taipei('2027-02-15T09:00'); // 週一
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'A', type: 'task', durationMinutes: 5 * DAY, calendarId: 'CAL', actualStart, remainingMinutes: 2 * DAY },
    ],
    dependencies: [{ predecessorId: 'A', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 }],
    anchor: { taskId: 'ANCH', instant: taipei('2027-04-01T18:00') },
    statusDate,
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = r.tasks.find((t) => t.id === 'A')!;
  assert.equal(fromTaipei(a.earlyStart), '2027-02-01 09:00'); // 開始鎖定於實績
  assert.equal(fromTaipei(a.earlyFinish), '2027-02-16 18:00'); // 剩餘 2d 自狀態日(02-15)前推
  assert.ok(a.earlyFinish > statusDate); // 預測完成不落在狀態日之前
});

test('G6 負例：進行中剩餘工時無法於掛件前完成 → 衝突', () => {
  const actualStart = taipei('2027-02-01T09:00');
  const statusDate = taipei('2027-02-15T09:00');
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'A', type: 'task', durationMinutes: 5 * DAY, calendarId: 'CAL', actualStart, remainingMinutes: 2 * DAY },
    ],
    dependencies: [{ predecessorId: 'A', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 }],
    // 掛件在 02-16 09:00，早於剩餘 2d 自 02-15 前推之完成(02-16 18:00) → 不可行
    anchor: { taskId: 'ANCH', instant: taipei('2027-02-16T09:00') },
    statusDate,
  };
  const r = schedule(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// =============================================================================
// G9 late_days（§7：late_days = max(0, countWorkingDays(baseline.finish, forecast.finish)))
// =============================================================================
test('G9 late_days：預測晚於基準 → 正逾期工作日；不晚於 → 0', () => {
  // 基準 週一 03-01 18:00，預測 週四 03-04 18:00 → 週一~週四 = 4 個工作日
  assert.equal(lateDays(taipei('2027-03-01T18:00'), taipei('2027-03-04T18:00'), CAL), 4);
  // 預測早於/等於基準 → 0（未逾期）
  assert.equal(lateDays(taipei('2027-03-04T18:00'), taipei('2027-03-01T18:00'), CAL), 0);
  assert.equal(lateDays(taipei('2027-03-01T18:00'), taipei('2027-03-01T18:00'), CAL), 0);
  // 跨週末不計：週五 03-05 → 次週一 03-08 = 週五、週一 = 2 個工作日
  assert.equal(lateDays(taipei('2027-03-05T18:00'), taipei('2027-03-08T18:00'), CAL), 2);
});
