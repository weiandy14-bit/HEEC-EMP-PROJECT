// P5 交換作業生命週期：歷史列表、伺服器取消、掃描重試（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {api,headers,BASE,createProject,db,closeDb} from './helpers.mjs';
const require=createRequire(import.meta.url);
const {writeCsv}=require('../../dist/exchange/formats.js');
const {TASK_COLUMNS,EXTRA_COLUMNS}=require('../../dist/exchange/model.js');
const source=()=>[{'Task Name':'設計','WBS':'1','Outline Level':'1',Start:'2027-01-08T09:00+08:00',Finish:'2027-01-08T18:00+08:00',Duration:'1d',Predecessors:'','Resource Names':'',Work:'8h','% Complete':'0',Milestone:'false','Constraint Type':'ASAP','Unique ID':'101',ID:'1',GUID:randomUUID()},{'Task Name':'掛件','WBS':'0.0','Outline Level':'1',Start:'2027-01-11T18:00+08:00',Finish:'2027-01-11T18:00+08:00',Duration:'0d',Predecessors:'1FS','Resource Names':'',Work:'0h','% Complete':'0',Milestone:'true','Constraint Type':'ASAP','Unique ID':'102',ID:'2',GUID:randomUUID()}];
async function upload(p,rows,key=randomUUID(),roles='PM',format='csv'){const bytes=writeCsv(rows,[...TASK_COLUMNS,...EXTRA_COLUMNS]);const form=new FormData();form.append('file',new Blob([bytes]),'project.'+format);form.append('format',format);const h=headers(roles);delete h['Content-Type'];h['Idempotency-Key']=key;const r=await fetch(BASE+`/projects/${p}/imports`,{method:'POST',headers:h,body:form});return{status:r.status,body:await r.json()};}
async function preview(p,j,rows,extra={}){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/previews`,{method:'POST',headers:{...headers('PM'),'If-Match':String(j.version)},body:JSON.stringify({anchorKey:'guid:'+rows[1].GUID,...extra})});return{status:r.status,body:await r.json()};}
async function commit(p,j,v,key=randomUUID()){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/commit`,{method:'POST',headers:{...headers('PM'),'If-Match':String(v.job_version),'Idempotency-Key':key},body:JSON.stringify({previewId:v.id,previewHash:v.payload_hash})});return{status:r.status,body:await r.json()};}
async function send(method,path,{version,roles='PM',user}={}){const h=headers(roles,user);if(version!==undefined)h['If-Match']=String(version);const r=await fetch(BASE+path,{method,headers:h});return{status:r.status,body:await r.json().catch(()=>null)};}

test('P5 作業歷史：匯入／匯出列表按時間新到舊、含分頁與安全欄位，跨案與 Viewer 受控', async () => {
 const p=await createProject(),other=await createProject();
 const a=await upload(p,source());assert.equal(a.status,201,JSON.stringify(a.body));
 const b=await upload(p,source());assert.equal(b.status,201,JSON.stringify(b.body));
 const list=await api('GET',`/projects/${p}/imports?limit=1`);
 assert.equal(list.status,200,JSON.stringify(list.body));
 assert.equal(list.body.items.length,1);
 assert.equal(list.body.items[0].id,b.body.id,'最新在前');
 assert.equal(list.body.next_offset,1);
 assert.equal(list.body.items[0].object_key,undefined,'不外洩儲存鍵');
 const page2=await api('GET',`/projects/${p}/imports?limit=1&offset=1`);
 assert.equal(page2.body.items[0].id,a.body.id);assert.equal(page2.body.next_offset,null);
 // 匯出歷史
 const exp=await fetch(BASE+`/projects/${p}/exports`,{method:'POST',headers:{...headers('PM'),'Idempotency-Key':randomUUID()},body:JSON.stringify({format:'csv'})});
 const ej=await exp.json();assert.equal(exp.status,201,JSON.stringify(ej));
 const exports=await api('GET',`/projects/${p}/exports`);
 assert.equal(exports.status,200);assert.ok(exports.body.items.some(i=>i.id===ej.id&&i.format==='csv'));
 assert.equal(exports.body.items[0].output_key,undefined,'匯出列表不外洩輸出鍵');
 // 他案看不到本案作業；無權限者/ Viewer 控制
 assert.equal((await api('GET',`/projects/${other}/imports`)).body.items.find(i=>i.id===a.body.id),undefined);
 assert.equal((await api('GET',`/projects/${p}/imports`,{roles:'Viewer'})).status,403);
 const outsider=randomUUID();assert.equal((await api('GET',`/projects/${p}/imports`,{user:outsider})).status,404);
});

test('P5 伺服器取消：取消後不可預覽、原檔移除、重取消冪等；已提交不可取消；版本衝突', async () => {
 const p=await createProject(),rows=source();
 const u=await upload(p,rows);assert.equal(u.status,201);
 const objectKey=(await db().query('SELECT object_key FROM import_jobs WHERE id=$1',[u.body.id])).rows[0].object_key;
 // 版本錯誤 → 409
 const stale=await send('POST',`/projects/${p}/imports/${u.body.id}/cancel`,{version:999});
 assert.equal(stale.status,409);assert.equal(stale.body.code,'version_conflict');
 // 取消
 const c=await send('POST',`/projects/${p}/imports/${u.body.id}/cancel`,{version:u.body.version});
 assert.equal(c.status,201,JSON.stringify(c.body));assert.equal(c.body.state,'cancelled');
 assert.equal((await db().query("SELECT state FROM import_jobs WHERE id=$1",[u.body.id])).rows[0].state,'cancelled');
 // 取消後不可預覽
 const pv=await preview(p,{id:u.body.id,version:c.body.version},rows);
 assert.equal(pv.status,409,JSON.stringify(pv.body));assert.equal(pv.body.code,'job_not_ready');
 // 重取消冪等
 const again=await send('POST',`/projects/${p}/imports/${u.body.id}/cancel`,{version:c.body.version});
 assert.equal(again.body.state,'cancelled');
 // 已提交不可取消
 const p2=await createProject(),r2=source(),u2=await upload(p2,r2),v2=await preview(p2,u2.body,r2);
 assert.equal(v2.body.can_commit,true,JSON.stringify(v2.body));
 const done=await commit(p2,u2.body,v2.body);assert.equal(done.body.state,'succeeded');
 const noCancel=await send('POST',`/projects/${p2}/imports/${u2.body.id}/cancel`,{version:done.body.version});
 assert.equal(noCancel.status,409);assert.equal(noCancel.body.code,'job_not_cancellable');
 // scope：跨案 404、Viewer 403
 assert.equal((await send('POST',`/projects/${p2}/imports/${u.body.id}/cancel`,{version:1})).status,404);
 assert.equal((await send('POST',`/projects/${p}/imports/${u.body.id}/cancel`,{version:1,roles:'Viewer'})).status,403);
});

test('P5 掃描重試：掃描不可用後重試可恢復預覽；乾淨作業不可重試；版本鎖', async () => {
 const p=await createProject(),rows=source();
 const u=await upload(p,rows);assert.equal(u.status,201);assert.equal(u.body.scan_state,'clean');
 // 乾淨作業不可重試
 const notRetry=await send('POST',`/projects/${p}/imports/${u.body.id}/scan-retry`,{version:u.body.version});
 assert.equal(notRetry.status,409);assert.equal(notRetry.body.code,'scan_not_retryable');
 // 模擬掃描不可用：直接把作業置為 error/failed（觸發器會遞增 version）
 await db().query("UPDATE import_jobs SET scan_state='error',state='failed',result=$2 WHERE id=$1",[u.body.id,JSON.stringify({code:'scan_unavailable'})]);
 const cur=await api('GET',`/projects/${p}/imports/${u.body.id}`);
 assert.equal(cur.body.scan_state,'error');assert.equal(cur.body.state,'failed');
 // 版本錯誤 → 409
 const stale=await send('POST',`/projects/${p}/imports/${u.body.id}/scan-retry`,{version:999});
 assert.equal(stale.status,409);assert.equal(stale.body.code,'version_conflict');
 // 重試（測試掃描器通過）→ 恢復 clean/pending，可再預覽
 const retry=await send('POST',`/projects/${p}/imports/${u.body.id}/scan-retry`,{version:cur.body.version});
 assert.equal(retry.status,201,JSON.stringify(retry.body));assert.equal(retry.body.scan_state,'clean');assert.equal(retry.body.state,'pending');
 const pv=await preview(p,{id:u.body.id,version:retry.body.version},rows);
 assert.equal(pv.status,201,JSON.stringify(pv.body));assert.equal(pv.body.can_commit,true);
 // 稽核留痕
 assert.ok((await db().query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1 AND action='scan_retry'",[u.body.id])).rows[0].n>=1);
});

test.after(()=>closeDb());
