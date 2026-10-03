// P4-B 本週重要事項（跨案；整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, createProject, db, closeDb, ORG, PM_USER, FIRE_TEMPLATE } from './helpers.mjs';

const TZ = 480, DAY = 86_400_000, H = 3_600_000;
function weekMondayUtcMs(y, w) {
  const jan4 = Date.UTC(y, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dow * DAY + (w - 1) * 7 * DAY - TZ * 60000;
}
const iso = (ms) => new Date(ms).toISOString();
const WK = '2027-W11';
const MON = weekMondayUtcMs(2027, 11);
const inWeek = iso(MON + 2 * DAY + 10 * H);   // 週三 10:00
const future = iso(MON + 14 * DAY + 10 * H);  // 兩週後
const overdue = iso(MON - 2 * DAY);           // 前一週（逾期）

async function board(extra = '') {
  const r = await api('GET', `/dashboard/weekly?week=${WK}${extra}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const find = (body, id) => body.items.find((i) => i.id === id);

async function makeDeliverable(p, due, name) {
  const r = await api('POST', `/projects/${p}/deliverables`, {
    body: { name: name ?? '圖-' + randomUUID().slice(0, 8), due_at: due },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}
async function makeStep(p, due, status = 'submitted', owner = PM_USER) {
  const rev = await api('POST', `/projects/${p}/reviews`, { body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局' } });
  assert.equal(rev.status, 201, JSON.stringify(rev.body));
  const s = await api('POST', `/projects/${p}/reviews/${rev.body.id}/steps`, { body: { step_code: 'SUBMIT', due_at: due, owner_id: owner, status } });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  return s.body.id;
}
async function makeMeeting(p, starts) {
  const r = await api('POST', `/projects/${p}/meetings`, { body: { starts_at: starts, topic: '協調會議', organizer_id: PM_USER } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

test('P4-B1 跨案彙整：交圖/送審/會議 各型別 + 案件/來源欄位', async () => {
  const p1 = await createProject(), p2 = await createProject();
  const dId = await makeDeliverable(p1, inWeek);
  const sId = await makeStep(p2, inWeek, 'submitted');
  const mId = await makeMeeting(p1, inWeek);
  const b = await board();
  const d = find(b, dId), s = find(b, sId), m = find(b, mId);
  assert.ok(d && s && m, '三型別皆彙整');
  assert.equal(d.type, '交圖'); assert.equal(d.source.kind, 'deliverable'); assert.ok(d.project_name);
  assert.equal(s.type, '送審'); assert.equal(s.source.kind, 'review_step'); assert.equal(s.assignee_id, PM_USER);
  assert.equal(m.type, '會議'); assert.equal(m.source.kind, 'meeting');
});

test('P4-B2 週切換：本週項目於本週查得；他週項目不在本週', async () => {
  const p = await createProject();
  const thisWeek = await makeDeliverable(p, inWeek);
  const other = await makeDeliverable(p, future);
  const b = await board();
  assert.ok(find(b, thisWeek), '本週交圖在本週');
  assert.equal(find(b, other), undefined, '兩週後交圖不在本週（未逾期）');
});

test('P4-B3 逾期持續顯示 + 完成回寫後消失', async () => {
  const p = await createProject();
  const od = await makeDeliverable(p, overdue); // draft、逾期
  let b = await board();
  const item = find(b, od);
  assert.ok(item && item.overdue === true, '逾期未完成於本週持續顯示且標記 overdue');
  // 完成回寫：submitted → accepted
  await api('PATCH', `/projects/${p}/deliverables/${od}`, { body: { status: 'submitted' } });
  const acc = await api('PATCH', `/projects/${p}/deliverables/${od}`, { body: { status: 'accepted' } });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  b = await board();
  assert.equal(find(b, od), undefined, '完成後不再逾期顯示');
});

test('P4-B4 權限：Viewer 可讀；無 scope 使用者看不到他人案件事項', async () => {
  const p = await createProject();
  const dId = await makeDeliverable(p, inWeek);
  const viewer = await api('GET', `/dashboard/weekly?week=${WK}`, { roles: 'Viewer' });
  assert.equal(viewer.status, 200);
  assert.ok(viewer.body.items.find((i) => i.id === dId), 'Viewer（同為建立者脈絡）可見');
  // 另一同 org 使用者（非建立者/成員）→ 看不到
  const other = randomUUID();
  const r = await api('GET', `/dashboard/weekly?week=${WK}`, { user: other, roles: 'PM,Lead' });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.find((i) => i.id === dId), undefined, '無 scope 者看不到該案事項');
});

test('P4-B5 篩選：type=會議 僅會議；assignee 篩選送審', async () => {
  const p = await createProject();
  await makeDeliverable(p, inWeek);
  const sId = await makeStep(p, inWeek, 'submitted', PM_USER);
  const mId = await makeMeeting(p, inWeek);
  const onlyMeetings = await board('&type=會議');
  assert.ok(onlyMeetings.items.length > 0 && onlyMeetings.items.every((i) => i.type === '會議'), '僅會議');
  assert.ok(find(onlyMeetings, mId));
  const byAssignee = await board('&type=送審&assignee=' + PM_USER);
  assert.ok(find(byAssignee, sId), 'assignee 篩選回該送審步驟');
});

test('P4-B 補正：status=revision → 類型補正', async () => {
  const p = await createProject();
  const sId = await makeStep(p, inWeek, 'revision', PM_USER);
  const b = await board();
  const s = find(b, sId);
  assert.ok(s && s.type === '補正', 'revision 類型為補正');
});

test.after(async () => { await closeDb(); });

test('P4-B complete: crossing-period source, project/owner filters, detail, completion and IDOR',async()=>{
 const p=await createProject(),other=await createProject();
 const w=await api('POST',`/projects/${p}/weekly-items`,{body:{title:'跨週內部審查',source_key:'acceptance-'+randomUUID(),type:'general',owner_id:PM_USER,period_start:iso(MON),period_end:iso(MON+10*DAY),due_at:iso(MON+10*DAY)}});
 assert.equal(w.status,201,JSON.stringify(w.body));
 for(const week of ['2027-W11','2027-W12']){const b=await api('GET',`/dashboard/weekly?week=${week}&project_id=${p}&assignee=${PM_USER}`);assert.equal(b.status,200);assert.equal(b.body.items.filter(i=>i.id===w.body.id).length,1);}
 const path=`/dashboard/weekly/sources/${p}/weekly_item/${w.body.id}`;
 const detail=await api('GET',path);assert.equal(detail.status,200);assert.equal(detail.body.actions[0].status,'done');
 assert.equal((await api('GET',path,{roles:'Viewer'})).body.actions.length,0);
 assert.equal((await api('GET',path.replace(p,other))).status,404);
 const outsider=randomUUID();assert.equal((await api('GET',path,{user:outsider})).status,404);
 assert.equal((await api('PATCH',`/projects/${p}/weekly-items/${w.body.id}`,{roles:'Viewer',body:{status:'done'}})).status,403);
 assert.equal((await api('PATCH',`/projects/${p}/weekly-items/${w.body.id}`,{user:outsider,body:{status:'done'}})).status,404);
 const done=await api('PATCH',`/projects/${p}/weekly-items/${w.body.id}`,{body:{status:'done'}});assert.equal(done.status,200);assert.ok(done.body.completed_at);
 const later=await api('GET',`/dashboard/weekly?week=2027-W13&project_id=${p}`);assert.equal(later.body.items.some(i=>i.id===w.body.id),false);
 assert.equal((await api('GET','/dashboard/weekly?week=2027-W53')).status,422);
});

test('P4-B paging has stable ordering, no duplicate IDs and named options',async()=>{
 const p=await createProject();
 await db().query(`INSERT INTO weekly_items(org_id,project_id,type,title,due_at,source_key,owner_id) SELECT $1,$2,'general','Item '||n,$3,'pager-'||n,$4 FROM generate_series(1,121)n`,[ORG,p,inWeek,PM_USER]);
 const seen=new Set();let offset=0;
 do{const r=await api('GET',`/dashboard/weekly?week=${WK}&project_id=${p}&limit=50&offset=${offset}`);assert.equal(r.status,200);for(const i of r.body.items){assert.ok(!seen.has(i.id));seen.add(i.id);}offset=r.body.next_offset;}while(offset!=null);
 assert.equal(seen.size,121);
 const opts=await api('GET','/dashboard/weekly/options');assert.ok(opts.body.projects.some(v=>v.id===p));assert.ok(opts.body.owners.some(v=>v.id===PM_USER));
});

test('P4-U5 real DB source failure returns placeholders and preserves healthy source rows',async()=>{
 await import('reflect-metadata');
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {WeeklyBoardService}=require('../../dist/dashboard/weekly.service.js');
 const p=await createProject(),m=await makeMeeting(p,inWeek);
 const service=new WeeklyBoardService({query:async(sql,params)=>{
  if(sql.includes('FROM deliverables d JOIN projects'))return (await db().query('SELECT * FROM phase4_intentionally_missing_relation')).rows;
  return (await db().query(sql,params)).rows;
 }});
 const board=await service.board({orgId:ORG,userId:PM_USER,roles:['PM']},{week:WK,project_id:p});
 assert.equal(board.partial_errors.length,1);assert.equal(board.partial_errors[0].kind,'deliverable');assert.ok(board.items.some(i=>i.id===m));
});
