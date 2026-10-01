// P4-C 工程師未來四週負荷（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, createProject, db, closeDb, ORG } from './helpers.mjs';

const TZ = 480, DAY = 86_400_000, H = 3_600_000;
function weekMondayUtcMs(y, w) {
  const jan4 = Date.UTC(y, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const wk1 = jan4 - dow * DAY;
  return wk1 + (w - 1) * 7 * DAY - TZ * 60000;
}
const iso = (ms) => new Date(ms).toISOString();
const FROM = '2027-W10';
const W0 = weekMondayUtcMs(2027, 10);
const W1 = W0 + 7 * DAY;
// 當週 Mon 09:00 → Fri 18:00（台北），即該週完整工作窗（工作分鐘=2400）
const monMorning = (wStart) => wStart + 9 * H;
const friEvening = (wStart) => wStart + 4 * DAY + 18 * H;

async function makeResource({ max_units = 1, active_from = null, active_to = null, org = ORG } = {}) {
  const id = randomUUID();
  await db().query(
    `INSERT INTO resources (id, org_id, code, name, type, max_units, active_from, active_to)
     VALUES ($1,$2,$3,'工程師','labor',$4,$5,$6)`,
    [id, org, 'R-' + id.slice(0, 8), max_units, active_from, active_to]);
  return id;
}
async function makeTask(p, over = {}) {
  const r = await api('POST', `/projects/${p}/tasks`, { body: { wbs_code: '1', name: '任務', duration_minutes: 480, ...over } });
  assert.equal(r.status, 201, 'makeTask: ' + JSON.stringify(r.body));
  return r.body.id;
}
async function assign(p, taskId, resId, { units = 1, work = 480, start, finish, booking = 'committed' }) {
  await db().query(
    `INSERT INTO resource_assignments
       (org_id, project_id, task_id, resource_id, assignment_units, planned_work_minutes,
        assignment_start, assignment_finish, booking_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ORG, p, taskId, resId, units, work, start, finish, booking]);
}
async function matrix(over = '') {
  const r = await api('GET', `/dashboard/workload?from_week=${FROM}&weeks=4${over}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const findRes = (body, id) => body.resources.find((x) => x.resource_id === id);

test('P4-C1 基準：單案單週 8h / 可用 40h → load_rate 0.2', async () => {
  const p = await createProject();
  const t = await makeTask(p);
  const res = await makeResource();
  await assign(p, t, res, { work: 480, start: iso(monMorning(W0)), finish: iso(friEvening(W0)) });
  const body = await matrix(`&resource_id=${res}`);
  const cell = findRes(body, res).cells[0];
  assert.equal(cell.demand_minutes, 480);
  assert.equal(cell.capacity_minutes, 2400);
  assert.equal(cell.load_rate, 0.2);
});

test('P4-C2 跨案/跨週：需求正確分攤、來源跨專案', async () => {
  const p1 = await createProject(), p2 = await createProject();
  const t1 = await makeTask(p1), t2 = await makeTask(p2);
  const res = await makeResource();
  // A1：跨 week0~week1（工作窗 4800 分）、work 960 → 每週 480
  await assign(p1, t1, res, { work: 960, start: iso(monMorning(W0)), finish: iso(friEvening(W1)) });
  // A2：僅 week0、work 480
  await assign(p2, t2, res, { work: 480, start: iso(monMorning(W0)), finish: iso(friEvening(W0)) });
  const body = await matrix(`&resource_id=${res}`);
  const r = findRes(body, res);
  assert.equal(r.cells[0].demand_minutes, 960); // 480 + 480
  assert.equal(r.cells[1].demand_minutes, 480); // A1 第二週
  assert.equal(r.cells[0].sources.length, 2, 'week0 來源含兩專案');
  assert.ok(r.cells[0].sources.some((s) => s.project_id === p1) && r.cells[0].sources.some((s) => s.project_id === p2));
});

test('P4-C3 部分投入/Max Units：units 不乘 Work；重疊時段峰值>Max 才衝突', async () => {
  const p = await createProject();
  const res = await makeResource({ max_units: 1 });
  // 兩筆同一重疊時段（週一 09:00–12:00）各 0.75 units → 峰值 1.5 > 1 → 衝突；Work 僅各自計
  const tA = await makeTask(p, { wbs_code: 'A' }), tB = await makeTask(p, { wbs_code: 'B' });
  const olStart = iso(W0 + 9 * H), olEnd = iso(W0 + 12 * H);
  await assign(p, tA, res, { units: 0.75, work: 180, start: olStart, finish: olEnd });
  await assign(p, tB, res, { units: 0.75, work: 180, start: olStart, finish: olEnd });
  let r = findRes(await matrix(`&resource_id=${res}`), res);
  assert.ok(r.cells[0].flags.includes('simultaneous_conflict'), '重疊 1.5 units 應衝突');
  assert.equal(r.cells[0].demand_minutes, 360, 'Work=180+180，units 不乘入');

  // 不同日各 100% → 不衝突
  const res2 = await makeResource({ max_units: 1 });
  const tC = await makeTask(p, { wbs_code: 'C' }), tD = await makeTask(p, { wbs_code: 'D' });
  await assign(p, tC, res2, { units: 1, work: 180, start: iso(W0 + 9 * H), finish: iso(W0 + 12 * H) });       // 週一
  await assign(p, tD, res2, { units: 1, work: 180, start: iso(W0 + DAY + 9 * H), finish: iso(W0 + DAY + 12 * H) }); // 週二
  r = findRes(await matrix(`&resource_id=${res2}`), res2);
  assert.ok(!r.cells[0].flags.includes('simultaneous_conflict'), '不同日不相加、不衝突');
});

test('P4-C4 個人假期降低可用；零容量不除以零', async () => {
  // 零容量：max_units=0 + 有需求 → capacity 0、load_rate null、zero_capacity + over_allocated
  const p = await createProject();
  const t = await makeTask(p);
  const zero = await makeResource({ max_units: 0 });
  await assign(p, t, zero, { work: 120, start: iso(monMorning(W0)), finish: iso(friEvening(W0)) });
  const rz = findRes(await matrix(`&resource_id=${zero}`), zero);
  assert.equal(rz.cells[0].capacity_minutes, 0);
  assert.equal(rz.cells[0].load_rate, null);
  assert.ok(rz.cells[0].flags.includes('zero_capacity'));
  assert.ok(rz.cells[0].flags.includes('over_allocated'));

  // 個人假期：專屬日曆（Mon-Fri 8h）+ week0 週一假期(available_minutes=0) → 可用 2400→1920
  const calId = randomUUID();
  await db().query(`INSERT INTO calendars (id, org_id, name, timezone, hours_per_day, status) VALUES ($1,$2,'個人','Asia/Taipei',8,'active')`, [calId, ORG]);
  await db().query(
    `INSERT INTO calendar_working_days (org_id, calendar_id, weekday, local_start, local_end)
     SELECT $1,$2,wd,s::time,e::time FROM (VALUES
       (1,'09:00','12:00'),(1,'13:00','18:00'),(2,'09:00','12:00'),(2,'13:00','18:00'),
       (3,'09:00','12:00'),(3,'13:00','18:00'),(4,'09:00','12:00'),(4,'13:00','18:00'),
       (5,'09:00','12:00'),(5,'13:00','18:00')) AS v(wd,s,e)`, [ORG, calId]);
  const mondayDate = new Date(W0 + TZ * 60000).toISOString().slice(0, 10); // 台北週一日期
  await db().query(`INSERT INTO calendar_exceptions (org_id, calendar_id, local_date, available_minutes, reason) VALUES ($1,$2,$3,0,'個人假')`, [ORG, calId, mondayDate]);
  const onLeave = await makeResource({ max_units: 1 });
  await db().query(`INSERT INTO resource_calendars (org_id, resource_id, calendar_id, priority) VALUES ($1,$2,$3,10)`, [ORG, onLeave, calId]);
  const rl = findRes(await matrix(`&resource_id=${onLeave}`), onLeave);
  assert.equal(rl.cells[0].capacity_minutes, 1920, '週一假期扣 480 → 1920');
  assert.ok(rl.cells[0].flags.includes('on_leave'));
});

test('P4-C5 權限/IDOR：跨 org 工程師不出現、drill-down 404、無 cost_rate', async () => {
  // 他 org 資源
  const otherOrg = randomUUID();
  await db().query(`INSERT INTO organizations (id, code, name) VALUES ($1,$2,'他組織')`, [otherOrg, 'ORG-' + otherOrg.slice(0, 8)]);
  const foreign = await makeResource({ org: otherOrg });
  const body = await matrix();
  assert.equal(findRes(body, foreign), undefined, '他 org 工程師不出現');
  // cost_rate 不外洩
  for (const r of body.resources) assert.ok(!('cost_rate' in r), '不含 cost_rate');
  // drill-down 跨 org → 404
  const d = await api('GET', `/dashboard/workload/resources/${foreign}?from_week=${FROM}`);
  assert.equal(d.status, 404);
});

test('P4-C6 未指派清單 + teamSummary + drill-down', async () => {
  const p = await createProject();
  await db().query(`UPDATE projects SET status='active' WHERE id=$1`, [p]);
  // 有工時、無指派之葉工作 → 應列 unassigned
  const orphan = await makeTask(p, { wbs_code: 'ORPH', duration_minutes: 480 });
  await db().query(`UPDATE project_tasks SET planned_start=$2, planned_finish=$3 WHERE id=$1`,
    [orphan, iso(monMorning(W0)), iso(friEvening(W0))]);
  const res = await makeResource();
  const t = await makeTask(p, { wbs_code: 'ASG' });
  await assign(p, t, res, { work: 480, start: iso(monMorning(W0)), finish: iso(friEvening(W0)) });

  const body = await matrix();
  assert.ok(Array.isArray(body.unassigned) && body.unassigned.some((u) => u.task_id === orphan), '未指派工作列入清單');
  assert.ok(Array.isArray(body.teamSummary), 'teamSummary 存在');

  const d = await api('GET', `/dashboard/workload/resources/${res}?from_week=${FROM}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.resource_id, res);
  assert.ok(Array.isArray(d.body.cells) && d.body.cells.length === 4);
});

test('P4-C RBAC：Viewer 可讀負荷(唯讀)', async () => {
  const r = await api('GET', `/dashboard/workload?from_week=${FROM}`, { roles: 'Viewer' });
  assert.equal(r.status, 200);
});

test.after(async () => { await closeDb(); });
