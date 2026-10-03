// =============================================================================
// 排程核心：CPM 正/逆向計算、浮時、關鍵路徑（§7）
// 純函式：相同輸入 → 相同輸出（可 hash 比對，見 T09）。
// 模型：掛件錨點為固定完成瞬間，逆向拉排；計畫日期採 latest（as-late-as-possible）。
// =============================================================================

import { addWorking, subtractWorking, workingMinutesBetween } from './calendar.ts';
import { forwardBound, backwardBound } from './dependencies.ts';
import {
  ENGINE_VERSION,
  type Calendar,
  type Dependency,
  type Minute,
  type ScheduleConflict,
  type ScheduleInput,
  type ScheduleResult,
  type ScheduledTask,
  type Task,
} from './types.ts';

const DEFAULT_MAX_NEG_LAG = 30 * 480; // 30 工作日 × 8h（D06 預設上限）

interface Ctx {
  tasks: Map<string, Task>;
  calById: Map<string, Calendar>;
  outEdges: Map<string, Dependency[]>; // predecessor -> deps
  inEdges: Map<string, Dependency[]>;  // successor -> deps
}

function calOf(ctx: Ctx, task: Task): Calendar {
  const c = ctx.calById.get(task.calendarId);
  if (!c) throw new Error(`invalid_calendar:${task.calendarId}`);
  return c;
}

function lagCalOf(ctx: Ctx, dep: Dependency): Calendar {
  const id = dep.lagCalendarId ?? ctx.tasks.get(dep.successorId)?.calendarId;
  const c = id ? ctx.calById.get(id) : undefined;
  if (!c) throw new Error(`invalid_calendar:lag:${dep.successorId}`);
  return c;
}

/** 驗證輸入；回傳致命衝突清單（空=通過）。 */
function validate(input: ScheduleInput, ctx: Ctx): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const maxNeg = input.maxNegativeLagMinutes ?? DEFAULT_MAX_NEG_LAG;

  for (const t of input.tasks) {
    if (t.durationMinutes < 0) {
      conflicts.push({ kind: 'negative_duration', message: `工期為負：${t.id}`, taskIds: [t.id] });
    }
    if (!ctx.calById.has(t.calendarId)) {
      conflicts.push({ kind: 'invalid_calendar', message: `任務日曆不存在：${t.id}`, taskIds: [t.id] });
    }
  }
  for (const d of input.dependencies) {
    if (!ctx.tasks.has(d.predecessorId) || !ctx.tasks.has(d.successorId)) {
      conflicts.push({
        kind: 'orphan',
        message: `相依參照不存在之工作`,
        edge: { predecessorId: d.predecessorId, successorId: d.successorId },
      });
    }
    if (d.lagMinutes < 0 && -d.lagMinutes > maxNeg) {
      conflicts.push({
        kind: 'lag_out_of_bounds',
        message: `負 lag 超過上限 ${maxNeg} 分：${d.predecessorId}->${d.successorId}`,
        edge: { predecessorId: d.predecessorId, successorId: d.successorId },
      });
    }
  }
  if (!ctx.tasks.has(input.anchor.taskId)) {
    conflicts.push({ kind: 'anchor_conflict', message: `錨點工作不存在：${input.anchor.taskId}` });
  }
  return conflicts;
}

/** 拓樸排序（Kahn）；回傳排序或偵測到環。scheduled = 需排入之工作集合。 */
function topoSort(scheduled: Set<string>, ctx: Ctx): { order?: string[]; cycle?: string[] } {
  const indeg = new Map<string, number>();
  for (const id of scheduled) indeg.set(id, 0);
  for (const id of scheduled) {
    for (const d of ctx.outEdges.get(id) ?? []) {
      if (scheduled.has(d.successorId)) indeg.set(d.successorId, (indeg.get(d.successorId) ?? 0) + 1);
    }
  }
  const queue = [...scheduled].filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const d of ctx.outEdges.get(id) ?? []) {
      if (!scheduled.has(d.successorId)) continue;
      const n = (indeg.get(d.successorId) ?? 0) - 1;
      indeg.set(d.successorId, n);
      if (n === 0) queue.push(d.successorId);
    }
    queue.sort();
  }
  if (order.length !== scheduled.size) {
    const cycle = [...scheduled].filter((id) => (indeg.get(id) ?? 0) > 0);
    return { cycle };
  }
  return { order };
}

/** 每個 scheduled 工作是否能循 successor 邊到達錨點。 */
function reachAnchor(scheduled: Set<string>, anchorId: string, ctx: Ctx): Set<string> {
  const canReach = new Set<string>([anchorId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of scheduled) {
      if (canReach.has(id)) continue;
      for (const d of ctx.outEdges.get(id) ?? []) {
        if (canReach.has(d.successorId)) { canReach.add(id); changed = true; break; }
      }
    }
  }
  return canReach;
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const ctx: Ctx = {
    tasks: new Map(input.tasks.map((t) => [t.id, t])),
    calById: new Map(input.calendars.map((c) => [c.id, c])),
    outEdges: new Map(),
    inEdges: new Map(),
  };
  for (const d of input.dependencies) {
    (ctx.outEdges.get(d.predecessorId) ?? ctx.outEdges.set(d.predecessorId, []).get(d.predecessorId)!).push(d);
    (ctx.inEdges.get(d.successorId) ?? ctx.inEdges.set(d.successorId, []).get(d.successorId)!).push(d);
  }

  const fatal = validate(input, ctx);
  if (fatal.length) return { ok: false, conflicts: fatal, engineVersion: ENGINE_VERSION };

  // 分離 summary（不排入核心）；其餘葉工作與錨點納入。
  const scheduled = new Set<string>();
  for (const t of input.tasks) if (t.type !== 'summary') scheduled.add(t.id);

  const conflicts: ScheduleConflict[] = [];

  // 孤立/未連通：每個 scheduled 工作須有通向錨點之路（D03）。
  const canReach = reachAnchor(scheduled, input.anchor.taskId, ctx);
  for (const id of scheduled) {
    if (!canReach.has(id)) {
      conflicts.push({ kind: 'orphan', message: `工作無通向錨點之路：${id}`, taskIds: [id] });
    }
  }

  const topo = topoSort(scheduled, ctx);
  if (topo.cycle) {
    conflicts.push({ kind: 'cycle', message: `偵測到相依環`, taskIds: topo.cycle.sort() });
  }
  if (conflicts.length) return { ok: false, conflicts, engineVersion: ENGINE_VERSION };

  const order = topo.order!;
  const anchorInstant = input.anchor.instant;

  const LF = new Map<string, Minute>();
  const LS = new Map<string, Minute>();
  const ES = new Map<string, Minute>();
  const EF = new Map<string, Minute>();

  // ---- 逆向（latest）：反拓樸，自錨點固定完成瞬間 ----
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = ctx.tasks.get(id)!;
    const cal = calOf(ctx, t);

    const lfCandidates: Minute[] = [];
    const lsCandidates: Minute[] = [];

    if (id === input.anchor.taskId) {
      lfCandidates.push(anchorInstant); // 錨點固定
    }
    // 後續邊界
    for (const d of ctx.outEdges.get(id) ?? []) {
      if (!scheduled.has(d.successorId)) continue;
      const lagCal = lagCalOf(ctx, d);
      const b = backwardBound(d.relation, LS.get(d.successorId)!, LF.get(d.successorId)!, d.lagMinutes, lagCal);
      if (b.finishUb !== undefined) lfCandidates.push(b.finishUb);
      if (b.startUb !== undefined) lsCandidates.push(b.startUb);
    }
    // 限制（FNLT/MFO → LF 上界；SNLT/MSO → LS 上界）
    const c = t.constraint;
    if (c?.date !== undefined) {
      if (c.type === 'FNLT' || c.type === 'MFO') lfCandidates.push(c.date);
      if (c.type === 'SNLT' || c.type === 'MSO') lsCandidates.push(c.date);
    }
    // 實際完成鎖定
    if (t.actualFinish !== undefined) lfCandidates.push(t.actualFinish);

    // 以 duration 將 LS 上界轉為 LF 上界，取最緊（最小）
    for (const ls of lsCandidates) lfCandidates.push(addWorking(ls, t.durationMinutes, cal));
    if (lfCandidates.length === 0) {
      // 非錨點卻無後續與限制：理論上已被 reachAnchor 擋下
      lfCandidates.push(anchorInstant);
    }
    const lf = Math.min(...lfCandidates);
    const ls = subtractWorking(lf, t.durationMinutes, cal);
    LF.set(id, lf);
    LS.set(id, ls);
  }

  // 專案起始基準：所有工作最早之 LS（供無前置工作之下界，確保浮時正確）
  const projectStartFloor = Math.min(...order.map((id) => LS.get(id)!));

  // ---- 順向（earliest）：拓樸，自前置與最早限制 ----
  for (const id of order) {
    const t = ctx.tasks.get(id)!;
    const cal = calOf(ctx, t);

    const esCandidates: Minute[] = [projectStartFloor];
    const efCandidates: Minute[] = [];

    for (const d of ctx.inEdges.get(id) ?? []) {
      if (!scheduled.has(d.predecessorId)) continue;
      const lagCal = lagCalOf(ctx, d);
      const b = forwardBound(d.relation, ES.get(d.predecessorId)!, EF.get(d.predecessorId)!, d.lagMinutes, lagCal);
      if (b.startLb !== undefined) esCandidates.push(b.startLb);
      if (b.finishLb !== undefined) efCandidates.push(b.finishLb);
    }
    const c = t.constraint;
    if (c?.date !== undefined) {
      if (c.type === 'SNET' || c.type === 'MSO') esCandidates.push(c.date);
      if (c.type === 'FNET' || c.type === 'MFO') efCandidates.push(c.date);
    }
    if (t.actualStart !== undefined) esCandidates.push(t.actualStart);
    if (input.statusDate !== undefined && t.actualStart === undefined && t.actualFinish === undefined) {
      // 未開始之工作剩餘部分不得排在狀態日之前
      esCandidates.push(input.statusDate);
    }

    // finish 下界轉為 start 下界（依本任務日曆反推 duration）
    for (const ef of efCandidates) esCandidates.push(subtractWorking(ef, t.durationMinutes, cal));

    let es = Math.max(...esCandidates);
    if (t.actualStart !== undefined) es = t.actualStart; // 開始鎖定於實績
    let ef: Minute;
    if (t.actualFinish !== undefined) {
      // 已完成：完成鎖定於實績
      ef = t.actualFinish;
    } else if (t.actualStart !== undefined) {
      // 進行中：開始固定於實績，剩餘片段自 max(statusDate, actualStart) 前推
      const remaining = t.remainingMinutes ?? t.durationMinutes;
      const base =
        input.statusDate !== undefined ? Math.max(input.statusDate, es) : es;
      ef = addWorking(base, remaining, cal);
    } else {
      // 未開始：以全工期自 ES 前推
      ef = addWorking(es, t.durationMinutes, cal);
    }
    ES.set(id, es);
    EF.set(id, ef);
  }

  // ---- 浮時、超出量、可行性 ----
  interface Calc {
    es: Minute; ef: Minute; ls: Minute; lf: Minute;
    totalFloat: number; freeFloat: number;
    startOverrun: number; finishOverrun: number;
    lockedOverrun: boolean; // 超出完全由已鎖定實績造成（既成事實之落後）
  }
  const calc = new Map<string, Calc>();
  for (const id of order) {
    const t = ctx.tasks.get(id)!;
    const cal = calOf(ctx, t);
    const es = ES.get(id)!, ef = EF.get(id)!, ls = LS.get(id)!, lf = LF.get(id)!;

    // 總浮時：LS−ES 之工作分鐘（負值代表超期關鍵）
    const totalFloat = ls >= es
      ? workingMinutesBetween(es, ls, cal)
      : -workingMinutesBetween(ls, es, cal);

    // 自由浮時：本任務延後而不推遲任一後續 earliest 的最小 slack
    let freeFloat = Number.POSITIVE_INFINITY;
    const outs = (ctx.outEdges.get(id) ?? []).filter((d) => scheduled.has(d.successorId));
    if (outs.length === 0) {
      freeFloat = totalFloat; // 無後續：自由浮時等同總浮時
    } else {
      for (const d of outs) {
        const succ = ctx.tasks.get(d.successorId)!;
        const succCal = calOf(ctx, succ);
        const lagCal = lagCalOf(ctx, d);
        const b = forwardBound(d.relation, es, ef, d.lagMinutes, lagCal);
        const succES = ES.get(d.successorId)!;
        const succEF = EF.get(d.successorId)!;
        let slack: number;
        if (b.startLb !== undefined) slack = workingMinutesBetween(b.startLb, succES, lagCal);
        else slack = workingMinutesBetween(b.finishLb!, succEF, succCal);
        freeFloat = Math.min(freeFloat, Math.max(0, slack));
      }
    }
    if (!Number.isFinite(freeFloat)) freeFloat = 0;

    // 超出以「工作時間」判斷（Fri18:00 與 Mon09:00 同一工作位置，其間 0 工作分鐘，不誤判）。
    const startOverrun = es > ls ? workingMinutesBetween(ls, es, cal) : 0;
    const finishOverrun = ef > lf ? workingMinutesBetween(lf, ef, cal) : 0;
    // 超出是否完全由已鎖定實績造成（actualStart 晚於 LS、actualFinish 晚於 LF）
    const startLocked = t.actualStart !== undefined && es === t.actualStart;
    const finishLocked = t.actualFinish !== undefined && ef === t.actualFinish;
    const lockedOverrun =
      (startOverrun > 0 || finishOverrun > 0) &&
      (startOverrun === 0 || startLocked) &&
      (finishOverrun === 0 || finishLocked);

    calc.set(id, { es, ef, ls, lf, totalFloat, freeFloat, startOverrun, finishOverrun, lockedOverrun });
  }

  // 既成事實之落後會沿後續邊向下游傳遞：以鎖定實績超出之工作為種子，
  // 其可達之後續（含錨點）之超出亦屬「超期關鍵」而非可拒絕之規劃衝突。
  const behind = new Set<string>();
  const queue: string[] = [];
  for (const id of order) if (calc.get(id)!.lockedOverrun) { behind.add(id); queue.push(id); }
  while (queue.length) {
    const id = queue.shift()!;
    for (const d of ctx.outEdges.get(id) ?? []) {
      if (scheduled.has(d.successorId) && !behind.has(d.successorId)) {
        behind.add(d.successorId);
        queue.push(d.successorId);
      }
    }
  }

  const results: ScheduledTask[] = [];
  for (const id of order) {
    const c = calc.get(id)!;
    let overCritical = false;
    if (c.startOverrun > 0 || c.finishOverrun > 0) {
      if (c.lockedOverrun || behind.has(id)) {
        // 既成事實之落後（本任務鎖定超出，或位於落後任務之下游）：標記而不拒絕
        overCritical = true;
      } else {
        // 預測/限制/前置造成之超出（如 MFO 晚於掛件、進行中剩餘無法趕上）：拒絕發布
        conflicts.push({
          kind: 'constraint_conflict',
          message: `無法於錨點允許日期內完成：${id}（超出 start ${c.startOverrun} / finish ${c.finishOverrun} 工作分鐘）`,
          taskIds: [id],
        });
      }
    }

    results.push({
      id,
      earlyStart: c.es,
      earlyFinish: c.ef,
      lateStart: c.ls,
      lateFinish: c.lf,
      totalFloatMinutes: c.totalFloat,
      freeFloatMinutes: c.freeFloat,
      critical: c.totalFloat <= 0,
      overCritical,
    });
  }

  if (conflicts.length) return { ok: false, conflicts, engineVersion: ENGINE_VERSION };
  return { ok: true, tasks: results, engineVersion: ENGINE_VERSION };
}
