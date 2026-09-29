import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule,
  addWorking,
  subtractWorking,
  hashInput,
  hashResult,
  type ScheduleInput,
  type Task,
  type Dependency,
} from '../src/index.ts';
import { standardCalendar, taipei, fromTaipei, DAY, HOUR } from './helpers.ts';

const CAL = standardCalendar();

function anchorTask(id: string): Task {
  return { id, type: 'anchor', durationMinutes: 0, calendarId: 'CAL' };
}
function leaf(id: string, days: number): Task {
  return { id, type: 'task', durationMinutes: days * DAY, calendarId: 'CAL' };
}
function dep(p: string, s: string, relation: Dependency['relation'], lagMin = 0): Dependency {
  return { predecessorId: p, successorId: s, relation, lagMinutes: lagMin };
}
function byId(r: Extract<ReturnType<typeof schedule>, { ok: true }>, id: string) {
  const t = r.tasks.find((x) => x.id === id);
  assert.ok(t, `找不到工作 ${id}`);
  return t!;
}

// -------------------------------------------------------------------------
test('T01：週五掛件、單一 1d FS 工作 → 前一可工作日完成，週末略過', () => {
  // 掛件錨點在週一 09:00；1d 工作 FS 前置 → 應於前一工作日（週五）完成。
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-01-11T09:00') };
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 1)],
    dependencies: [dep('A', 'ANCHOR', 'FS')],
    anchor,
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = byId(r, 'A');
  assert.equal(fromTaipei(a.lateFinish), '2027-01-08 18:00'); // 週五完成
  assert.equal(fromTaipei(a.lateStart), '2027-01-08 09:00');
  assert.equal(a.critical, true); // 唯一路徑，浮時 0
});

test('T02：基設 A 5d、協調 B 3d SS+1d → B 於 A 開始後一工作日啟動，允許重疊', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-02-01T09:00') };
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 5), leaf('B', 3)],
    dependencies: [dep('A', 'B', 'SS', DAY), dep('A', 'ANCHOR', 'FS'), dep('B', 'ANCHOR', 'FS')],
    anchor,
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = byId(r, 'A');
  const b = byId(r, 'B');
  // B 開始 = A 開始 + 1 工作日
  assert.equal(b.earlyStart, addWorking(a.earlyStart, DAY, CAL));
  // 允許重疊：B 開始早於 A 完成
  assert.ok(b.earlyStart < a.earlyFinish);
});

test('T03：FS−4h 與午休 → 後續可在前項完成前 4 工作小時開始', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-02-01T09:00') };
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 2), leaf('B', 2)],
    dependencies: [dep('A', 'B', 'FS', -4 * HOUR), dep('B', 'ANCHOR', 'FS')],
    anchor,
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = byId(r, 'A');
  const b = byId(r, 'B');
  // B 開始 = A 完成往前 4 工作小時（跨午休亦僅計工作時間）
  assert.equal(b.earlyStart, subtractWorking(a.earlyFinish, 4 * HOUR, CAL));
  assert.ok(b.earlyStart < a.earlyFinish); // 負 lag 造成重疊
});

test('T04：FF、SF 各一鏈 → 界限依 finish/start 公式，無倒置', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-03-01T09:00') };
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 3), leaf('B', 2), leaf('C', 2), leaf('D', 2)],
    dependencies: [
      dep('A', 'B', 'FF', DAY), // B.finish >= A.finish + 1d
      dep('C', 'D', 'SF', DAY), // D.finish >= C.start + 1d
      dep('B', 'ANCHOR', 'FS'),
      dep('D', 'ANCHOR', 'FS'),
    ],
    anchor,
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = byId(r, 'A'), b = byId(r, 'B'), c = byId(r, 'C'), d = byId(r, 'D');
  // FF：B 完成 >= A 完成 + 1d
  assert.ok(b.earlyFinish >= addWorking(a.earlyFinish, DAY, CAL));
  // SF：D 完成 >= C 開始 + 1d
  assert.ok(d.earlyFinish >= addWorking(c.earlyStart, DAY, CAL));
  // 無倒置：start <= finish
  for (const t of r.tasks) assert.ok(t.earlyStart <= t.earlyFinish && t.lateStart <= t.lateFinish);
});

test('T05：假日 → 任務按 project calendar 略過假日', () => {
  const calH = standardCalendar('CAL', [{ localDate: '2027-01-07', availableMinutes: 0 }]); // 週四假日
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-01-11T09:00') };
  const input: ScheduleInput = {
    calendars: [calH],
    tasks: [anchorTask('ANCHOR'), leaf('A', 3)],
    dependencies: [dep('A', 'ANCHOR', 'FS')],
    anchor,
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = byId(r, 'A');
  // 3d 反推自週一 09:00：週五、(週四假日略過)、週三、週二 → 開始週二 09:00
  assert.equal(fromTaipei(a.lateFinish), '2027-01-08 18:00');
  assert.equal(fromTaipei(a.lateStart), '2027-01-05 09:00');
});

test('T06：循環 / 孤立 / 負工期 → 拒絕並列出節點與邊', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-03-01T09:00') };
  // 循環 A->B->A
  const cyc = schedule({
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 1), leaf('B', 1)],
    dependencies: [dep('A', 'B', 'FS'), dep('B', 'A', 'FS'), dep('A', 'ANCHOR', 'FS')],
    anchor,
  });
  assert.equal(cyc.ok, false);
  if (!cyc.ok) assert.ok(cyc.conflicts.some((c) => c.kind === 'cycle'));

  // 孤立：X 無通向錨點之路
  const orph = schedule({
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 1), leaf('X', 1)],
    dependencies: [dep('A', 'ANCHOR', 'FS')],
    anchor,
  });
  assert.equal(orph.ok, false);
  if (!orph.ok) assert.ok(orph.conflicts.some((c) => c.kind === 'orphan' && c.taskIds?.includes('X')));

  // 負工期
  const neg = schedule({
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), { id: 'A', type: 'task', durationMinutes: -10, calendarId: 'CAL' }],
    dependencies: [dep('A', 'ANCHOR', 'FS')],
    anchor,
  });
  assert.equal(neg.ok, false);
  if (!neg.ok) assert.ok(neg.conflicts.some((c) => c.kind === 'negative_duration'));
});

test('T07：MustFinishOn 晚於固定掛件所允許日期 → scheduling conflict', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-01-11T09:00') };
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      anchorTask('ANCHOR'),
      { id: 'A', type: 'task', durationMinutes: DAY, calendarId: 'CAL',
        constraint: { type: 'MFO', date: taipei('2027-01-20T18:00') } }, // 晚於掛件
    ],
    dependencies: [dep('A', 'ANCHOR', 'FS')],
    anchor,
  };
  const r = schedule(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.conflicts.some((c) => c.kind === 'constraint_conflict' && c.taskIds?.includes('A')));
});

test('T08：已完成任務之實績鎖定不被重排', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-03-01T09:00') };
  const actualStart = taipei('2027-01-04T09:00');
  const actualFinish = taipei('2027-01-06T18:00');
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks: [
      anchorTask('ANCHOR'),
      { id: 'A', type: 'task', durationMinutes: 3 * DAY, calendarId: 'CAL', actualStart, actualFinish },
      leaf('B', 2),
    ],
    dependencies: [dep('A', 'B', 'FS'), dep('B', 'ANCHOR', 'FS')],
    anchor,
    statusDate: taipei('2027-01-07T09:00'),
  };
  const r = schedule(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = byId(r, 'A');
  assert.equal(a.earlyStart, actualStart);
  assert.equal(a.earlyFinish, actualFinish); // 鎖定，不移動
});

test('T09：相同輸入 → 相同 input/result hash（含輸入順序無關）', () => {
  const anchor = { taskId: 'ANCHOR', instant: taipei('2027-02-01T09:00') };
  const base: ScheduleInput = {
    calendars: [CAL],
    tasks: [anchorTask('ANCHOR'), leaf('A', 2), leaf('B', 3)],
    dependencies: [dep('A', 'B', 'FS'), dep('B', 'ANCHOR', 'FS'), dep('A', 'ANCHOR', 'FS')],
    anchor,
  };
  // 打亂順序之等價輸入
  const shuffled: ScheduleInput = {
    calendars: [CAL],
    tasks: [leaf('B', 3), leaf('A', 2), anchorTask('ANCHOR')],
    dependencies: [dep('B', 'ANCHOR', 'FS'), dep('A', 'ANCHOR', 'FS'), dep('A', 'B', 'FS')],
    anchor,
  };
  assert.equal(hashInput(base), hashInput(shuffled));
  const r1 = schedule(base), r2 = schedule(shuffled);
  assert.ok(r1.ok && r2.ok);
  if (r1.ok && r2.ok) assert.equal(hashResult(r1.tasks), hashResult(r2.tasks));
});

test('T10：5000 tasks 鏈 → 可行且於門檻內完成', () => {
  const n = 5000;
  const tasks: Task[] = [anchorTask('ANCHOR')];
  const deps: Dependency[] = [];
  for (let i = 0; i < n; i++) {
    tasks.push(leaf('T' + i, 1));
    if (i > 0) deps.push(dep('T' + (i - 1), 'T' + i, 'FS'));
  }
  deps.push(dep('T' + (n - 1), 'ANCHOR', 'FS'));
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks,
    dependencies: deps,
    anchor: { taskId: 'ANCHOR', instant: taipei('2030-01-01T09:00') },
  };
  const t0 = performance.now();
  const r = schedule(input);
  const ms = performance.now() - t0;
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tasks.length, n + 1);
  assert.ok(r.tasks.every((t) => t.critical)); // 單一長鏈全關鍵
  assert.ok(ms < 5000, `排程耗時 ${ms.toFixed(0)}ms 應 < 5000ms`);
});
