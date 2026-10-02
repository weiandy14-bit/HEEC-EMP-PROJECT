// P4-A1 多案總控甘特（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, createProject, db, closeDb, ORG, PM_USER, FIRE_TEMPLATE } from './helpers.mjs';

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

test('P4-A4c project scope：同 org 但無該案權限 → 列表不含、drill-down 404', async () => {
  const a = await activeProjectWithTasks(); // 由 PM_USER 建立（created_by=PM_USER）
  // 同 org 另一使用者（非建立者/PM/成員/Admin）
  const other = randomUUID();
  const list = await api('GET', `/dashboard/gantt`, { user: other, roles: 'PM,Lead' });
  assert.equal(list.status, 200);
  assert.equal(findProject(list.body, a.p), undefined, '無權限者列表不含該案');
  const drill = await api('GET', `/projects/${a.p}/dashboard/gantt`, { user: other, roles: 'PM,Lead' });
  assert.equal(drill.status, 404, '無權限者 drill-down → 404（不洩存在性）');
  // 對照：建立者本人可見且可 drill-down
  const ownDrill = await api('GET', `/projects/${a.p}/dashboard/gantt`);
  assert.equal(ownDrill.status, 200);
});

test('P4-A4d project scope：成員關係授予可見性', async () => {
  const a = await activeProjectWithTasks();
  const member = randomUUID();
  // member 需為 users 之一（FK）；建立 org 內使用者後加入專案成員
  await db().query(
    `INSERT INTO users (id, org_id, issuer, subject, email, display_name, status)
     VALUES ($1,$2,'dev',$4,$3,'成員','active') ON CONFLICT DO NOTHING`,
    [member, ORG, `m-${member.slice(0, 8)}@test.local`, member]);
  await db().query(
    `INSERT INTO project_members (org_id, project_id, user_id, role_code)
     VALUES ($1,$2,$3,'Engineer')`, [ORG, a.p, member]);
  const list = await api('GET', `/dashboard/gantt`, { user: member, roles: 'Engineer' });
  assert.ok(findProject(list.body, a.p), '專案成員可見該案');
});

test('P4-A5(游標分頁)：101 個可視案件可完整翻頁取得第 101 筆', async () => {
  // 以 created_by=PM_USER 批次建立 101 個 active 案（確保對 PM_USER 可見）
  await db().query(
    `INSERT INTO projects (org_id, code, name, status, permit_filing_date, created_by)
     SELECT $1, 'PGN-'||lpad(gs::text,3,'0'), '分頁案'||gs, 'active', '2027-01-11', $2
       FROM generate_series(1,101) gs
     ON CONFLICT DO NOTHING`,
    [ORG, PM_USER]);

  const seen = new Set();
  let cursor = null;
  for (let i = 0; i < 30; i++) { // 上限保護
    const qs = `/dashboard/gantt?status=active&limit=50` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const r = await api('GET', qs);
    assert.equal(r.status, 200);
    for (const p of r.body.projects) if (p.code && p.code.startsWith('PGN-')) seen.add(p.code);
    cursor = r.body.next_cursor;
    if (!cursor) break;
  }
  assert.equal(seen.size, 101, '101 個 PGN 案件全數跨頁取得');
  assert.ok(seen.has('PGN-101'), '第 101 筆可取得');
});

test('P4-A6 filtered leaves keep WBS ancestors; resource/date/discipline match and invalid interval rejects', async () => {
  const a = await activeProjectWithTasks();
  const sibling = (await api('POST', `/projects/${a.p}/tasks`, {body:{wbs_code:'1.2',name:'Sibling',duration_minutes:480,parent_task_id:a.parent.id}})).body;
  await setPlannedCritical(a.child.id,'2027-01-12T01:00:00Z','2027-01-15T10:00:00Z');
  await setPlannedCritical(sibling.id,'2027-02-01T01:00:00Z','2027-02-02T10:00:00Z');
  const discipline = (await db().query(`SELECT id FROM disciplines WHERE enabled=true ORDER BY sort_order LIMIT 1`)).rows[0].id;
  await db().query(`UPDATE project_tasks SET discipline_id=$2 WHERE id=$1`,[a.child.id,discipline]);
  const res = randomUUID();
  await db().query(`INSERT INTO resources(id,org_id,code,name,type) VALUES($1,$2,$3,'Filter resource','labor')`,[res,ORG,'GF-'+res]);
  await db().query(`INSERT INTO resource_assignments(org_id,project_id,task_id,resource_id,planned_work_minutes) VALUES($1,$2,$3,$4,480)`,[ORG,a.p,a.child.id,res]);
  const r = await api('GET', `/dashboard/gantt?project_id=${a.p}&resource_id=${res}&discipline=${discipline}&from=2027-01-12T00:00:00Z&to=2027-01-16T00:00:00Z`);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(new Set(r.body.projects[0].tasks.map((t)=>t.id)),new Set([a.parent.id,a.child.id]));
  const other = await activeProjectWithTasks();
  const foreignMatch = await api('GET', `/dashboard/gantt?project_id=${other.p}&resource_id=${res}`);
  assert.equal(foreignMatch.body.projects.length,0);
  const invalid = await api('GET','/dashboard/gantt?from=2027-02-02T00:00:00Z&to=2027-02-01T00:00:00Z');
  assert.equal(invalid.status,422);
});

test('P4-A6 name options and task detail retain project scope; cross-project task UUID is rejected', async () => {
  const a = await activeProjectWithTasks(), b = await activeProjectWithTasks();
  const options = await api('GET','/dashboard/gantt/options');
  assert.equal(options.status,200,JSON.stringify(options.body));
  assert.ok(options.body.projects.some((p)=>p.id===a.p));
  assert.ok(options.body.disciplines.length>0);
  const detail = await api('GET',`/projects/${a.p}/dashboard/gantt/tasks/${a.child.id}`);
  assert.equal(detail.status,200,JSON.stringify(detail.body));
  assert.equal(detail.body.task.id,a.child.id);
  assert.ok(!('cost_rate' in detail.body.task));
  assert.equal((await api('GET',`/projects/${b.p}/dashboard/gantt/tasks/${a.child.id}`)).status,404);
  const outsider = randomUUID();
  assert.equal((await api('GET',`/projects/${a.p}/dashboard/gantt/tasks/${a.child.id}`,{user:outsider,roles:'Engineer'})).status,404);
  const hiddenOptions = await api('GET','/dashboard/gantt/options',{user:outsider,roles:'Engineer'});
  assert.equal(hiddenOptions.status,200);
  assert.equal(hiddenOptions.body.projects.some((p)=>p.id===a.p),false);
});

test.after(async () => { await closeDb(); });

test('P4-A5 task keyset pages reach all 501 tasks and retain hierarchy without losing UUIDs', async()=>{
 const a=await activeProjectWithTasks();
 await db().query(`UPDATE project_tasks SET sort_key='00000' WHERE id=$1`,[a.parent.id]);
 await db().query(`UPDATE project_tasks SET sort_key='00001' WHERE id=$1`,[a.child.id]);
 await db().query(`INSERT INTO project_tasks(org_id,project_id,wbs_code,sort_key,name,parent_task_id)
 SELECT $1,$2,'P.'||gs,lpad((gs+1)::text,5,'0'),'Paging '||gs,$3 FROM generate_series(1,499) gs`,[ORG,a.p,a.parent.id]);
 const seen=new Set(); let cursor=null; let pages=0;
 do {
  const r=await api('GET',`/dashboard/gantt?project_id=${a.p}&task_limit=200${cursor?'&task_cursor='+encodeURIComponent(cursor):''}`);
  assert.equal(r.status,200,JSON.stringify(r.body));
  const p=r.body.projects[0];
  assert.ok(p.tasks.some(t=>t.id===a.parent.id),'ancestor retained on every page');
  assert.ok(p.tasks.length<=201,'200 candidates plus ancestor');
  p.tasks.forEach(t=>seen.add(t.id)); cursor=p.task_next_cursor; pages++;
  assert.ok(pages<=4,'cursor progresses');
 }while(cursor);
 assert.equal(seen.size,501); assert.equal(pages,3);
 assert.equal((await api('GET',`/dashboard/gantt?project_id=${a.p}&task_cursor=invalid`)).status,422);
 assert.equal((await api('GET','/dashboard/gantt?task_cursor=invalid')).status,422);
});
