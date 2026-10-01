// P4-A1 多案總控甘特（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, createProject, db, closeDb, ORG, FIRE_TEMPLATE } from './helpers.mjs';

// 建立「進行中」案件 + 父子任務；回傳 ids
async function activeProjectWithTasks() {
  const p = await createProject(); // permit_filing_date=2027-01-11
  await db().query(`UPDATE projects SET status='active' WHERE id=$1`, [p]);
  const parent = (await api('POST', `/projects/${p}/tasks`, {
    body: { wbs_code: '1', name: '設計', duration_minutes: 0 },
  })).body;
  const child = (await api('POST', `/projects/${p}/tasks`, {
    body: { wbs_code: '1.1', name: '基本設計', duration_minutes: 2400, parent_task_id: parent.id },
  })).body;
  return { p, parent, child };
}

async function setPlannedCritical(taskId, start, finish, critical = false) {
  await db().query(
    `UPDATE project_tasks SET planned_start=$2, planned_finish=$3, critical=$4 WHERE id=$1`,
    [taskId, start, finish, critical],
  );
}
async function addActiveBaseline(p, taskId, start, finish) {
  const b = (await db().query(
    `INSERT INTO baselines (org_id, project_id, sequence_no, created_from_schedule_version, status)
     VALUES ($1,$2,1,0,'active') RETURNING id`, [ORG, p])).rows[0].id;
  await db().query(
    `INSERT INTO baseline_tasks (baseline_id, task_id, start_at, finish_at, task_name, wbs_code)
     VALUES ($1,$2,$3,$4,'基本設計','1.1')`, [b, taskId, start, finish]);
  return b;
}
const findProject = (body, id) => body.projects.find((x) => x.id === id);

test('P4-A1 多案於同一時間軸、WBS 父子、三態 bar', async () => {
  const a = await activeProjectWithTasks();
  const b = await activeProjectWithTasks();
  await setPlannedCritical(a.child.id, '2027-01-12T01:00:00Z', '2027-01-15T10:00:00Z');
  await addActiveBaseline(a.p, a.child.id, '2027-01-12T01:00:00Z', '2027-01-14T10:00:00Z');

  const r = await api('GET', `/dashboard/gantt`);
  assert.equal(r.status, 200);
  const pa = findProject(r.body, a.p);
  const pb = findProject(r.body, b.p);
  assert.ok(pa && pb, '兩個進行中案件皆列出於同一回應');
  // WBS 父子
  const child = pa.tasks.find((t) => t.id === a.child.id);
  const parent = pa.tasks.find((t) => t.id === a.parent.id);
  assert.ok(child && parent);
  assert.equal(child.parent_id, parent.id, '子任務指向父任務');
  // 三態 bar：planned 與 baseline 皆有值；actual 可為空
  assert.equal(child.planned.start, '2027-01-12T01:00:00.000Z');
  assert.ok(child.baseline.start, 'baseline bar 存在');
  assert.ok('actual' in child, 'actual 欄位存在');
});

test('P4-A2 掛件(permit_filing)唯一且=建照日；審查期限為獨立 review_due，不覆寫掛件日', async () => {
  const a = await activeProjectWithTasks();
  // 建立一筆法定審查，legal_due_date 與掛件日不同
  const rev = await api('POST', `/projects/${a.p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局', legal_due_date: '2027-02-01' },
  });
  assert.equal(rev.status, 201);

  const r = await api('GET', `/dashboard/gantt?zoom=month`);
  assert.equal(r.body.zoom, 'month');
  const pa = findProject(r.body, a.p);
  const filing = pa.milestones.filter((m) => m.kind === 'permit_filing');
  const reviewDue = pa.milestones.filter((m) => m.kind === 'review_due');
  assert.equal(filing.length, 1, '掛件里程碑每案唯一');
  assert.equal(filing[0].date, '2027-01-11', '掛件日=projects.permit_filing_date');
  assert.ok(reviewDue.some((m) => m.date === '2027-02-01'), '審查期限為獨立 review_due 事件');
  assert.notEqual(filing[0].date, '2027-02-01', '審查期限未冒充掛件日');
});

test('P4-A3 關鍵路徑高亮一致 + Baseline 對比', async () => {
  const a = await activeProjectWithTasks();
  await setPlannedCritical(a.child.id, '2027-01-12T01:00:00Z', '2027-01-15T10:00:00Z', true);
  await addActiveBaseline(a.p, a.child.id, '2027-01-12T01:00:00Z', '2027-01-14T10:00:00Z');
  const r = await api('GET', `/dashboard/gantt`);
  const child = findProject(r.body, a.p).tasks.find((t) => t.id === a.child.id);
  assert.equal(child.critical, true, 'critical 與 scheduler 標記一致');
  assert.equal(child.baseline.finish, '2027-01-14T10:00:00.000Z');
  assert.equal(child.planned.finish, '2027-01-15T10:00:00.000Z');
  assert.notEqual(child.baseline.finish, child.planned.finish, 'Baseline vs 計畫可對比');
});

test('P4-A4 權限/IDOR：他 org 案件不出現；跨案 drill-down 404；planning 狀態不列入', async () => {
  // 他 org + 其 active 專案
  const otherOrg = randomUUID();
  await db().query(`INSERT INTO organizations (id, code, name) VALUES ($1,$2,'他組織')`,
    [otherOrg, 'OTHERORG-' + otherOrg.slice(0, 8)]);
  const otherProj = randomUUID();
  await db().query(
    `INSERT INTO projects (id, org_id, code, name, status, permit_filing_date)
     VALUES ($1,$2,$3,'他案','active','2027-01-11')`,
    [otherProj, otherOrg, 'OP-' + otherProj.slice(0, 8)]);
  // planning 狀態之本 org 案（不應列入進行中甘特）
  const planning = await createProject();

  const r = await api('GET', `/dashboard/gantt`);
  assert.equal(findProject(r.body, otherProj), undefined, '他 org 案件不出現');
  assert.equal(findProject(r.body, planning), undefined, 'planning 狀態不列入進行中甘特');

  // 跨 org drill-down → 404（不洩存在性）
  const d = await api('GET', `/projects/${otherProj}/dashboard/gantt`);
  assert.equal(d.status, 404);
});

test('P4-A4b 單案 drill-down 正例：本 org 進行中案可取其甘特', async () => {
  const a = await activeProjectWithTasks();
  const d = await api('GET', `/projects/${a.p}/dashboard/gantt`);
  assert.equal(d.status, 200);
  assert.equal(d.body.id, a.p);
  assert.ok(d.body.tasks.length >= 2);
});

test('P4-A1 RBAC：Viewer 可讀甘特(唯讀)', async () => {
  const r = await api('GET', `/dashboard/gantt`, { roles: 'Viewer' });
  assert.equal(r.status, 200);
});

test.after(async () => { await closeDb(); });
