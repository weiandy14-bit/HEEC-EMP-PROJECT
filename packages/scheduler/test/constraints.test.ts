import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, type ScheduleInput, type ConstraintType, type TaskConstraint } from '../src/index.ts';
import { standardCalendar, taipei, fromTaipei, DAY } from './helpers.ts';

// =============================================================================
// G1 限制型別覆蓋（§7 關係界限/限制；§9 MSP Constraint Type）
//
// 原規格要求之限制型別（§7 偽碼明列 "apply MustFinishOn / FinishNoLaterThan /
//   StartNoEarlierThan" 與 ASAP 預設）：
//     ASAP、SNET、FNLT、MFO
// 新增之限制型別（為與 Microsoft Project 相容而補齊，§9 Constraint Type 泛稱；
//   僅新增各自邊界，不改變已核定規則—掛件錨點固定、日曆、SS 平行等維持不變）：
//     ALAP、SNLT、FNET、MSO
//
// 測試場景：長路徑 C(5d) 驅動排程，短工作 A(1d) 具浮時，便於觀察限制對 A 的效果。
// 基準（A 無限制）：ES 2027-02-23 09:00、EF 02-23 18:00、LS 03-01 09:00、LF 03-01 18:00。
// =============================================================================

const CAL = standardCalendar();
const ANCHOR_INSTANT = taipei('2027-03-01T18:00');

function run(constraint?: TaskConstraint) {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'C', type: 'task', durationMinutes: 5 * DAY, calendarId: 'CAL' },
      { id: 'A', type: 'task', durationMinutes: 1 * DAY, calendarId: 'CAL', constraint },
    ],
    dependencies: [
      { predecessorId: 'C', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
      { predecessorId: 'A', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: ANCHOR_INSTANT },
  };
  return schedule(input);
}
function A(r: ReturnType<typeof run>) {
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unexpected conflict');
  return r.tasks.find((t) => t.id === 'A')!;
}
function con(type: ConstraintType, iso: string): TaskConstraint {
  return { type, date: taipei(iso) };
}

// 上界型限制（FNLT/SNLT）之衝突需搭配「硬下界」：以 MSO 釘住前置 P，
// 迫使 A 落在較晚位置，再對 A 施加早於該位置之上界 → 衝突。
function runUpperBoundNeg(aConstraint: TaskConstraint) {
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      { id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' },
      { id: 'P', type: 'task', durationMinutes: 2 * DAY, calendarId: 'CAL', constraint: con('MSO', '2027-05-20T09:00') },
      { id: 'A', type: 'task', durationMinutes: 1 * DAY, calendarId: 'CAL', constraint: aConstraint },
    ],
    dependencies: [
      { predecessorId: 'P', successorId: 'A', relation: 'FS', lagMinutes: 0 },
      { predecessorId: 'A', successorId: 'ANCH', relation: 'FS', lagMinutes: 0 },
    ],
    anchor: { taskId: 'ANCH', instant: taipei('2027-06-01T18:00') },
  };
  return schedule(input);
}

// ---- 基準（無限制，ASAP 預設）[原規格] ----
test('G1 ASAP（預設）：A 於自然邊界，具浮時', () => {
  const a = A(run());
  assert.equal(fromTaipei(a.earlyStart), '2027-02-23 09:00');
  assert.equal(fromTaipei(a.lateFinish), '2027-03-01 18:00');
  assert.ok(a.totalFloatMinutes > 0);
});

// ---- SNET [原規格] ----
test('G1 SNET [原規格] 正例：ES 不早於指定日', () => {
  const a = A(run(con('SNET', '2027-02-25T09:00')));
  assert.equal(fromTaipei(a.earlyStart), '2027-02-25 09:00');
});
test('G1 SNET [原規格] 負例：指定日晚於允許最晚開始 → 衝突', () => {
  const r = run(con('SNET', '2027-03-02T09:00')); // 晚於 LS(03-01) 且逾掛件
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// ---- FNLT [原規格] ----
test('G1 FNLT [原規格] 正例：LF 不晚於指定日', () => {
  const a = A(run(con('FNLT', '2027-02-25T18:00')));
  assert.equal(fromTaipei(a.lateFinish), '2027-02-25 18:00');
});
test('G1 FNLT [原規格] 負例：硬下界（前置 MSO）迫使 A 晚於 FNLT → 衝突', () => {
  const r = runUpperBoundNeg(con('FNLT', '2027-05-10T18:00'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// ---- MFO [原規格] ----
test('G1 MFO [原規格] 正例：完成釘於指定日（ES=LS、EF=LF）', () => {
  const a = A(run(con('MFO', '2027-02-25T18:00')));
  assert.equal(fromTaipei(a.earlyFinish), '2027-02-25 18:00');
  assert.equal(fromTaipei(a.lateFinish), '2027-02-25 18:00');
});
test('G1 MFO [原規格] 負例：指定日晚於掛件允許 → 衝突（T07）', () => {
  const r = run(con('MFO', '2027-03-08T18:00'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// ---- SNLT [新增] ----
test('G1 SNLT [新增] 正例：LS 不晚於指定日（不改變 ES）', () => {
  const a = A(run(con('SNLT', '2027-02-24T09:00')));
  assert.equal(fromTaipei(a.lateStart), '2027-02-24 09:00');
  assert.equal(fromTaipei(a.earlyStart), '2027-02-23 09:00'); // ES 不受影響
});
test('G1 SNLT [新增] 負例：硬下界（前置 MSO）迫使 A 晚於 SNLT → 衝突', () => {
  const r = runUpperBoundNeg(con('SNLT', '2027-05-10T09:00'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// ---- FNET [新增] ----
test('G1 FNET [新增] 正例：EF 不早於指定日', () => {
  const a = A(run(con('FNET', '2027-02-26T18:00')));
  assert.equal(fromTaipei(a.earlyFinish), '2027-02-26 18:00');
});
test('G1 FNET [新增] 負例：指定日晚於允許最晚完成 → 衝突', () => {
  const r = run(con('FNET', '2027-03-03T18:00')); // 晚於 LF(03-01)
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// ---- MSO [新增] ----
test('G1 MSO [新增] 正例：開始釘於指定日（ES=LS）', () => {
  const a = A(run(con('MSO', '2027-02-25T09:00')));
  assert.equal(fromTaipei(a.earlyStart), '2027-02-25 09:00');
  assert.equal(fromTaipei(a.lateStart), '2027-02-25 09:00');
});
test('G1 MSO [新增] 負例：指定日晚於允許最晚開始 → 衝突', () => {
  const r = run(con('MSO', '2027-03-02T09:00'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict'));
});

// ---- ALAP [新增] ----
test('G1 ALAP [新增]：反向錨定模型下等同預設最晚放置，不改變已核定規則', () => {
  const alap = A(run(con('ALAP', '2027-01-01T00:00'))); // date 對 ALAP 無意義
  const baseline = A(run());
  // 計畫（最晚）日期與基準一致：新增型別不改變掛件錨定之排程結果
  assert.equal(alap.lateStart, baseline.lateStart);
  assert.equal(alap.lateFinish, baseline.lateFinish);
});
