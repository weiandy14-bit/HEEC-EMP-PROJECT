// P5 非同步交換（opt-in 202 + 背景 worker）整合測試，真實 DB。
// 涵蓋：接受、掃描完成、render 下載、驗證拒絕(permanent dead)、瞬時失敗重試→dead-letter、
// 重複投遞冪等、worker 中斷(lease 回收)、取消競爭、跨案/權限。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {api,headers,BASE,createProject,db,closeDb} from './helpers.mjs';
const require=createRequire(import.meta.url);
const {writeCsv}=require('../../dist/exchange/formats.js');
const {TASK_COLUMNS,EXTRA_COLUMNS}=require('../../dist/exchange/model.js');
const source=()=>[{'Task Name':'設計','WBS':'1','Outline Level':'1',Start:'2027-01-08T09:00+08:00',Finish:'2027-01-08T18:00+08:00',Duration:'1d',Predecessors:'','Resource Names':'',Work:'8h','% Complete':'0',Milestone:'false','Constraint Type':'ASAP','Unique ID':'101',ID:'1',GUID:randomUUID()},{'Task Name':'掛件','WBS':'0.0','Outline Level':'1',Start:'2027-01-11T18:00+08:00',Finish:'2027-01-11T18:00+08:00',Duration:'0d',Predecessors:'1FS','Resource Names':'',Work:'0h','% Complete':'0',Milestone:'true','Constraint Type':'ASAP','Unique ID':'102',ID:'2',GUID:randomUUID()}];

async function uploadAsync(p,bytes,key=randomUUID(),roles='PM'){const form=new FormData();form.append('file',new Blob([bytes]),'project.csv');form.append('format','csv');const h=headers(roles);delete h['Content-Type'];h['Idempotency-Key']=key;h['Prefer']='respond-async';const r=await fetch(BASE+`/projects/${p}/imports`,{method:'POST',headers:h,body:form});return{status:r.status,location:r.headers.get('location'),pref:r.headers.get('preference-applied'),body:await r.json()};}
const csv=(rows)=>writeCsv(rows,[...TASK_COLUMNS,...EXTRA_COLUMNS]);
async function previewAsync(p,j,rows){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/previews`,{method:'POST',headers:{...headers('PM'),'If-Match':String(j.version)},body:JSON.stringify({anchorKey:'guid:'+rows[1].GUID})});return{status:r.status,body:await r.json()};}
async function commit(p,j,v,key=randomUUID()){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/commit`,{method:'POST',headers:{...headers('PM'),'If-Match':String(v.job_version),'Idempotency-Key':key},body:JSON.stringify({previewId:v.id,previewHash:v.payload_hash})});return{status:r.status,body:await r.json()};}
async function runWorker(){let total=0;for(let i=0;i<10;i++){const r=await api('POST','/internal/exchange/worker',{roles:'Admin',body:{limit:50}});assert.equal(r.status,201,JSON.stringify(r.body));total+=r.body.claimed;if(r.body.claimed===0)break;}return total;}
const getImport=(p,j)=>api('GET',`/projects/${p}/imports/${j}`);
const workerRow=async(importJobId)=>(await db().query('SELECT * FROM exchange_worker_jobs WHERE import_job_id=$1',[importJobId])).rows[0];

test('P5 非同步上傳：202+Location、掃描前禁預覽、worker 掃描後可預覽並提交', async () => {
 const p=await createProject(),rows=source();
 const u=await uploadAsync(p,csv(rows));
 assert.equal(u.status,202,JSON.stringify(u.body));
 assert.equal(u.body.state,'pending');assert.equal(u.body.scan_state,'pending');
 assert.ok(u.body.status_url&&u.location&&u.location.endsWith(u.body.status_url),'Location 指向 status_url');
 assert.equal(u.pref,'respond-async');
 // 掃描完成前禁止預覽
 const early=await previewAsync(p,u.body,rows);assert.equal(early.status,409,JSON.stringify(early.body));assert.equal(early.body.code,'job_not_ready');
 // worker 實際執行掃描
 await runWorker();
 const after=await getImport(p,u.body.id);assert.equal(after.body.scan_state,'clean');assert.equal(after.body.state,'pending');
 assert.equal((await workerRow(u.body.id)).state,'succeeded');
 // 掃描後可預覽並提交
 const v=await previewAsync(p,{id:u.body.id,version:after.body.version},rows);assert.equal(v.body.can_commit,true,JSON.stringify(v.body));
 const done=await commit(p,u.body,v.body);assert.equal(done.body.state,'succeeded',JSON.stringify(done.body));
 // 稽核留痕：背景掃描
 assert.ok((await db().query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1 AND action='scan_clean'",[u.body.id])).rows[0].n>=1);
});

test('P5 非同步匯出：202、render 前禁下載、worker render 後可下載', async () => {
 const p=await createProject(),rows=source();
 // 先同步建資料
 const u=await uploadAsync(p,csv(rows));await runWorker();const after=await getImport(p,u.body.id);
 const v=await previewAsync(p,{id:u.body.id,version:after.body.version},rows);assert.equal((await commit(p,u.body,v.body)).body.state,'succeeded');
 // 非同步匯出
 const r=await fetch(BASE+`/projects/${p}/exports`,{method:'POST',headers:{...headers('PM'),'Idempotency-Key':randomUUID(),'Prefer':'respond-async'},body:JSON.stringify({format:'csv'})});
 const e=await r.json();assert.equal(r.status,202,JSON.stringify(e));assert.equal(e.state,'pending');assert.ok(e.status_url);
 // render 前禁下載
 const early=await api('GET',`/projects/${p}/exports/${e.id}/download`);assert.equal(early.status,409);assert.equal(early.body.code,'export_pending');
 await runWorker();
 const ge=await api('GET',`/projects/${p}/exports/${e.id}`);assert.equal(ge.body.state,'succeeded',JSON.stringify(ge.body));
 const file=await fetch(BASE+`/projects/${p}/exports/${e.id}/download`,{headers:headers('PM')});assert.equal(file.status,200);
});

test('P5 非同步驗證拒絕：結構無效檔→worker 永久失敗 dead，作業 failed，不可預覽', async () => {
 const p=await createProject();
 const bad=Buffer.from('﻿Task Name,Task Name\n重複表頭,x\n','utf8'); // 重複表頭 → 解析永久錯誤
 const u=await uploadAsync(p,bad);assert.equal(u.status,202);
 await runWorker();
 const after=await getImport(p,u.body.id);assert.equal(after.body.scan_state,'error');assert.equal(after.body.state,'failed');
 const wr=await workerRow(u.body.id);assert.equal(wr.state,'dead');assert.ok(wr.last_error);assert.equal(wr.attempts,1,'永久錯誤不重試');
 const pv=await previewAsync(p,{id:u.body.id,version:after.body.version},source());assert.equal(pv.status,409);
});

test('P5 非同步瞬時失敗：重試退避達上限→dead-letter，作業 failed', async () => {
 const p=await createProject(),rows=source();
 const u=await uploadAsync(p,csv(rows));assert.equal(u.status,202);
 // 注入瞬時基礎設施錯誤：原檔鍵指向不存在檔案（storage_unavailable=infrastructure=可重試）
 await db().query('UPDATE import_jobs SET object_key=$2 WHERE id=$1',[u.body.id,randomUUID()]);
 for(let round=1;round<=3;round++){await db().query("UPDATE exchange_worker_jobs SET available_at=now() WHERE import_job_id=$1 AND state IN('pending','failed')",[u.body.id]);await runWorker();const wr=await workerRow(u.body.id);if(round<3){assert.equal(wr.state,'failed',`第${round}輪應退避 failed`);assert.equal(wr.attempts,round);}else{assert.equal(wr.state,'dead',`第3輪 dead-letter`);assert.equal(wr.attempts,3);}}
 const after=await getImport(p,u.body.id);assert.equal(after.body.state,'failed');assert.equal(after.body.scan_state,'error');
});

test('P5 非同步重複投遞：同 key 同請求冪等，不重複排程或套用；異請求 409', async () => {
 const p=await createProject(),rows=source(),key=randomUUID(),bytes=csv(rows);
 const u1=await uploadAsync(p,bytes,key);assert.equal(u1.status,202);
 const u2=await uploadAsync(p,bytes,key);assert.equal(u2.body.id,u1.body.id,'同 key 同請求回同一作業');
 assert.equal((await db().query('SELECT count(*)::int n FROM exchange_worker_jobs WHERE import_job_id=$1',[u1.body.id])).rows[0].n,1,'只排程一次');
 await runWorker();await runWorker(); // 重複派工
 assert.equal((await db().query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1 AND action='scan_clean'",[u1.body.id])).rows[0].n,1,'只掃描套用一次');
 // 異請求同 key → 409
 const diff=await uploadAsync(p,csv([{...rows[0],'Task Name':'變更'},rows[1]]),key);assert.equal(diff.status,409);assert.equal(diff.body.code,'idempotency_conflict');
});

test('P5 worker 中斷恢復：租約逾期的 running 作業被回收並完成', async () => {
 const p=await createProject(),rows=source();
 const u=await uploadAsync(p,csv(rows));assert.equal(u.status,202);
 // 模擬 worker 認領後崩潰：state=running 且 lease 已逾期
 await db().query("UPDATE exchange_worker_jobs SET state='running',attempts=1,lease_until=now()-interval '5 minutes' WHERE import_job_id=$1",[u.body.id]);
 await runWorker();
 const wr=await workerRow(u.body.id);assert.equal(wr.state,'succeeded','逾期租約被回收並完成');
 assert.equal((await getImport(p,u.body.id)).body.scan_state,'clean');
});

test('P5 非同步取消競爭：取消後 worker 不得重新完成已取消作業', async () => {
 const p=await createProject(),rows=source();
 const u=await uploadAsync(p,csv(rows));assert.equal(u.status,202);
 // 取消（worker 尚未執行）
 const c=await fetch(BASE+`/projects/${p}/imports/${u.body.id}/cancel`,{method:'POST',headers:{...headers('PM'),'If-Match':String(u.body.version)}});
 assert.equal(c.status,201);assert.equal((await c.json()).state,'cancelled');
 await runWorker();
 const after=await getImport(p,u.body.id);assert.equal(after.body.state,'cancelled','取消後不被 worker 重新完成');
 assert.equal(after.body.scan_state,'pending');
 const wr=await workerRow(u.body.id);assert.equal(wr.state,'cancelled');
});

test('P5 非同步 scope/權限：跨案 404、worker 僅 Admin', async () => {
 const p=await createProject(),other=await createProject(),rows=source();
 const u=await uploadAsync(p,csv(rows));assert.equal(u.status,202);
 assert.equal((await api('GET',`/projects/${other}/imports/${u.body.id}`)).status,404);
 assert.equal((await uploadAsync(p,csv(rows),randomUUID(),'Viewer')).status,403);
 assert.equal((await api('POST','/internal/exchange/worker',{roles:'PM',body:{}})).status,403);
 assert.equal((await api('POST','/internal/exchange/worker',{roles:'Admin',body:{}})).status,201);
});

test.after(()=>closeDb());
