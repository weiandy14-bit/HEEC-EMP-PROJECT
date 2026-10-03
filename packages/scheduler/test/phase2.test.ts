import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule,
  workingMinutesBetween,
  subtractWorking,
  lateDays,
  type ScheduleInput,
  type Calendar,
} from '../src/index.ts';
import { standardCalendar, taipei, fromTaipei, DAY, HOUR } from './helpers.ts';

// UTC 日曆（+0，週一至週五 09:00–17:00，無午休），供跨日曆案例使用。
const CALU: Calendar = {
  id: 'CALU',
  tzOffsetMinutes: 0,
  weekly: [1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, startMinuteOfDay: 9 * 60, endMinuteOfDay: 17 * 60 })),
};
const utc = (m: number) => new Date(m * 60000).toISOString().slice(0, 16) + 'Z';

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
  if (!r.ok) return;
  const a = r.tasks.find((t) => t.id === 'A')!;
  const b = r.tasks.find((t) => t.id === 'B')!;
  // 實際重疊：B 開始早於 A 完成，且重疊量恰為 1 工作日（負 lag 造成）
  assert.ok(b.earlyStart < a.earlyFinish, 'B 應與 A 重疊');
  assert.equal(workingMinutesBetween(b.earlyStart, a.earlyFinish, CAL), DAY);
  // FS−1d：B 開始 = A 完成往前 1 工作日
  assert.equal(b.earlyStart, subtractWorking(a.earlyFinish, DAY, CAL));
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
test('G4 跨日曆：後續於前置完成之 UTC 事件（落在後續工作時段內）直接銜接', () => {
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
  // A 台北一個工作日完成 = 03-05 18:00 台北 = 10:00Z
  assert.equal(utc(a.earlyFinish), '2027-03-05T10:00Z');
  // 10:00Z 落在 CALU(09–17Z) 工作時段內 → B 直接開始
  assert.equal(utc(b.earlyStart), '2027-03-05T10:00Z');
  assert.equal(utc(b.earlyFinish), '2027-03-05T12:00Z');
  assert.ok(b.earlyStart >= a.earlyFinish);
});

test('G4 跨日曆：前置完成落在後續「非工作時段」→ 後續對齊自身日曆下一工作時段', () => {
  // 以 MSO 釘住 A 於台北 09:00 起，3h → 台北 12:00 完成 = 04:00Z，落在 CALU(09–17Z) 之前。
  // B（CALU）不得於 04:00Z 開始，須前移至 CALU 次一工作時段起點 09:00Z。
  const anchorUtc = Math.floor(Date.parse('2027-03-08T11:00:00Z') / 60000);
  const input: ScheduleInput = {
    calendars: [CAL, CALU],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CALU' },
      {
        id: 'A', type: 'task', durationMinutes: 3 * HOUR, calendarId: 'CAL',
        constraint: { type: 'MSO', date: taipei('2027-03-05T09:00') },
      },
      { id: 'B', type: 'task', durationMinutes: 2 * HOUR, calendarId: 'CALU' },
    ],
    dependencies: [
      { predecessorId: 'A', successorId: 'B', relation: 'FS', lagMinutes: 0 },
      { predecessorId: 'B', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: anchorUtc },
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = r.tasks.find((t) => t.id === 'A')!;
  const b = r.tasks.find((t) => t.id === 'B')!;
  assert.equal(utc(a.earlyFinish), '2027-03-05T04:00Z'); // 台北 12:00 = 04:00Z（CALU 非工作時段）
  // B 不在 04:00Z 開始，而是對齊 CALU 次一工作時段 09:00Z
  assert.equal(utc(b.earlyStart), '2027-03-05T09:00Z');
  assert.equal(utc(b.earlyFinish), '2027-03-05T11:00Z');
  assert.ok(b.earlyStart >= a.earlyFinish); // FS 界限仍成立（同一 UTC 軸比較）
});

// =============================================================================
// G5 超期關鍵（§7：負浮時標為超期關鍵）
// 已完成但落後之工作（實績晚於掛件錨點允許）→ 既成事實：仍產出排程並標 overCritical，
// 落後沿後續傳遞至錨點。無實績之限制/預測超出仍為衝突（見 T07/G1/G6 負例）。
// =============================================================================
test('G5 正例：完成實績晚於掛件允許 → overCritical、負浮時、仍可產出', () => {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      {
        id: 'A', type: 'task', durationMinutes: 2 * DAY, calendarId: 'CAL',
        actualStart: taipei('2027-01-11T09:00'), actualFinish: taipei('2027-01-15T18:00'),
      },
    ],
    dependencies: [{ predecessorId: 'A', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 }],
    anchor: { taskId: 'ANCH', instant: taipei('2027-01-11T18:00') }, // 掛件早於實際完成
  };
  const r = schedule(input);
  assert.equal(r.ok, true); // 既成事實之落後不拒絕，仍產出
  if (!r.ok) return;
  const a = r.tasks.find((t) => t.id === 'A')!;
  const anch = r.tasks.find((t) => t.id === 'ANCH')!;
  assert.ok(a.totalFloatMinutes < 0, '落後工作總浮時應為負');
  assert.equal(a.critical, true);
  assert.equal(a.overCritical, true);
  // 落後沿後續傳遞：錨點亦標為超期關鍵
  assert.equal(anch.overCritical, true);
  assert.ok(anch.totalFloatMinutes < 0);
});

test('G5 對照：無實績之限制超出（MFO 晚於掛件）仍為衝突，不標 overCritical', () => {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      {
        id: 'A', type: 'task', durationMinutes: DAY, calendarId: 'CAL',
        constraint: { type: 'MFO', date: taipei('2027-01-20T18:00') },
      },
    ],
    dependencies: [{ predecessorId: 'A', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 }],
    anchor: { taskId: 'ANCH', instant: taipei('2027-01-11T18:00') },
  };
  const r = schedule(input);
  assert.equal(r.ok, false); // 規劃衝突，拒絕發布
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
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
test('G9 late_days：起日不多算、跨週末不計、不晚於 → 0', () => {
  // 基準 週一 03-01 18:00（工作結束邊界）→ 預測 週四 03-04 18:00：
  // 起日週一已無剩餘工作分鐘，不計；逾期為 週二、週三、週四 = 3 個工作日（修正起日多算）。
  assert.equal(lateDays(taipei('2027-03-01T18:00'), taipei('2027-03-04T18:00'), CAL), 3);
  // 起日非結束邊界：週一 09:00 → 週三 18:00 = 週一、二、三 = 3
  assert.equal(lateDays(taipei('2027-03-01T09:00'), taipei('2027-03-03T18:00'), CAL), 3);
  // 預測早於/等於基準 → 0（未逾期）
  assert.equal(lateDays(taipei('2027-03-04T18:00'), taipei('2027-03-01T18:00'), CAL), 0);
  assert.equal(lateDays(taipei('2027-03-01T18:00'), taipei('2027-03-01T18:00'), CAL), 0);
  // 跨週末不計、起日不多算：週五 03-05 18:00 → 次週一 03-08 18:00 = 僅 週一 = 1 個工作日
  assert.equal(lateDays(taipei('2027-03-05T18:00'), taipei('2027-03-08T18:00'), CAL), 1);
});
