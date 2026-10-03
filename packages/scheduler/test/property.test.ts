import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule,
  addWorking,
  subtractWorking,
  workingMinutesBetween,
  snapForward,
  hashInput,
  hashResult,
  type ScheduleInput,
  type Task,
  type Dependency,
  type Relation,
} from '../src/index.ts';
import { standardCalendar, taipei, DAY } from './helpers.ts';

// G7 property-based（§10）：以固定種子 PRNG 產生隨機可行 DAG + 日曆，
// 驗證不變量：可行性、浮時非負與 critical 一致、相依界限恆成立、
// add/subtract 往返工作時間一致、相同語意輸入同 hash。

// 決定性 PRNG（mulberry32），確保 CI 可重現。
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAL = standardCalendar();
const RELATIONS: Relation[] = ['FS', 'SS', 'FF', 'SF'];

interface Gen { input: ScheduleInput; edges: Dependency[]; }

/** 產生一個保證無環、全連通至錨點、非負 lag 之隨機專案。 */
function genProject(rnd: () => number): Gen {
  const n = 2 + Math.floor(rnd() * 6); // 2..7 個葉工作
  const tasks: Task[] = [];
  for (let i = 0; i < n; i++) {
    const days = 1 + Math.floor(rnd() * 5); // 1..5 工作日
    tasks.push({ id: `T${i}`, type: 'task', durationMinutes: days * DAY, calendarId: 'CAL' });
  }
  tasks.push({ id: 'ANCH', type: 'anchor', durationMinutes: 0, calendarId: 'CAL' });

  const edges: Dependency[] = [];
  // 鏈：T0→T1→…→T_{n-1}→ANCH，確保連通與無環（僅由小索引指向大索引/錨點）
  for (let i = 0; i < n - 1; i++) {
    edges.push({ predecessorId: `T${i}`, successorId: `T${i + 1}`, relation: 'FS', lagMinutes: 0 });
  }
  edges.push({ predecessorId: `T${n - 1}`, successorId: 'ANCH', relation: 'FS', lagMinutes: 0 });
  // 隨機額外前向邊（i<j），關係與非負 lag 隨機
  const extra = Math.floor(rnd() * n);
  for (let k = 0; k < extra; k++) {
    const i = Math.floor(rnd() * n);
    const j = Math.floor(rnd() * n);
    if (i >= j) continue;
    const relation = RELATIONS[Math.floor(rnd() * 4)];
    const lagMinutes = Math.floor(rnd() * 3) * DAY; // 0..2 工作日，非負
    if (edges.some((e) => e.predecessorId === `T${i}` && e.successorId === `T${j}` && e.relation === relation)) continue;
    edges.push({ predecessorId: `T${i}`, successorId: `T${j}`, relation, lagMinutes });
  }

  // 錨點置於足夠遠之未來，確保可行
  const anchorInstant = taipei('2028-01-03T18:00') + Math.floor(rnd() * 50) * DAY;
  const input: ScheduleInput = {
    calendars: [CAL],
    tasks,
    dependencies: edges,
    anchor: { taskId: 'ANCH', instant: anchorInstant },
  };
  return { input, edges };
}

test('G7 property：隨機可行 DAG → 可行、浮時非負、critical 一致、相依界限成立', () => {
  const rnd = rng(20260930);
  for (let trial = 0; trial < 80; trial++) {
    const { input, edges } = genProject(rnd);
    const r = schedule(input);
    assert.equal(r.ok, true, `trial ${trial} 應可行`);
    if (!r.ok) continue;
    const by = new Map(r.tasks.map((t) => [t.id, t]));

    let hasCritical = false;
    for (const t of r.tasks) {
      // 無實績/限制 → 浮時非負
      assert.ok(t.totalFloatMinutes >= 0, `trial ${trial} ${t.id} 浮時應非負`);
      // critical 旗標與浮時一致
      assert.equal(t.critical, t.totalFloatMinutes <= 0);
      // 無負浮時 → 不應標超期關鍵
      assert.equal(t.overCritical, false);
      // 自由浮時不超過總浮時
      assert.ok(t.freeFloatMinutes <= t.totalFloatMinutes + 1);
      if (t.critical) hasCritical = true;
      // start <= finish
      assert.ok(t.earlyStart <= t.earlyFinish && t.lateStart <= t.lateFinish);
    }
    assert.ok(hasCritical, `trial ${trial} 應存在關鍵鏈`);

    // 相依界限：每條邊之關係下界於結果中成立（工作分鐘 >= lag）
    for (const e of edges) {
      const p = by.get(e.predecessorId)!;
      const s = by.get(e.successorId)!;
      let gap: number;
      switch (e.relation) {
        case 'FS': gap = workingMinutesBetween(p.earlyFinish, s.earlyStart, CAL); break;
        case 'SS': gap = workingMinutesBetween(p.earlyStart, s.earlyStart, CAL); break;
        case 'FF': gap = workingMinutesBetween(p.earlyFinish, s.earlyFinish, CAL); break;
        case 'SF': gap = workingMinutesBetween(p.earlyStart, s.earlyFinish, CAL); break;
      }
      assert.ok(gap >= e.lagMinutes, `trial ${trial} 邊 ${e.predecessorId}${e.relation}${e.successorId} 界限應成立（gap ${gap} >= lag ${e.lagMinutes}）`);
    }
  }
});

test('G7 property：add/subtract 往返工作時間一致', () => {
  const rnd = rng(12345);
  for (let i = 0; i < 300; i++) {
    const base = taipei('2027-01-01T00:00') + Math.floor(rnd() * 120) * 60; // 隨機分鐘
    const a = snapForward(base, CAL);
    const m = Math.floor(rnd() * 5000); // 0..~5000 工作分鐘
    // addWorking 恰好消耗 m 個工作分鐘
    assert.equal(workingMinutesBetween(a, addWorking(a, m, CAL), CAL), m);
    // subtractWorking 亦恰好回退 m 個工作分鐘
    const b = addWorking(a, m + DAY, CAL);
    assert.equal(workingMinutesBetween(subtractWorking(b, m, CAL), b, CAL), m);
  }
});

test('G7 property：相同語意輸入（打亂順序）→ 相同 input/result hash', () => {
  const rnd = rng(999);
  for (let trial = 0; trial < 40; trial++) {
    const { input } = genProject(rnd);
    const shuffled: ScheduleInput = {
      calendars: [...input.calendars].reverse(),
      tasks: [...input.tasks].reverse(),
      dependencies: [...input.dependencies].reverse(),
      anchor: input.anchor,
    };
    assert.equal(hashInput(input), hashInput(shuffled), `trial ${trial} inputHash 應相同`);
    const r1 = schedule(input);
    const r2 = schedule(shuffled);
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) assert.equal(hashResult(r1.tasks), hashResult(r2.tasks), `trial ${trial} resultHash 應相同`);
  }
});
