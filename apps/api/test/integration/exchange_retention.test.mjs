// P5 交換保存期限清理（整合測試，真實 DB）：過期檔案與不可變預覽清理，保留歷史、稽核與清理證據。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {api,headers,BASE,createProject,db,closeDb,ORG} from './helpers.mjs';
const require=createRequire(import.meta.url);
const {writeCsv}=require('../../dist/exchange/formats.js');
const {TASK_COLUMNS,EXTRA_COLUMNS}=require('../../dist/exchange/model.js');
const source=()=>[{'Task Name':'設計','WBS':'1','Outline Level':'1',Start:'2027-01-08T09:00+08:00',Finish:'2027-01-08T18:00+08:00',Duration:'1d',Predecessors:'','Resource Names':'',Work:'8h','% Complete':'0',Milestone:'false','Constraint Type':'ASAP','Unique ID':'101',ID:'1',GUID:randomUUID()},{'Task Name':'掛件','WBS':'0.0','Outline Level':'1',Start:'2027-01-11T18:00+08:00',Finish:'2027-01-11T18:00+08:00',Duration:'0d',Predecessors:'1FS','Resource Names':'',Work:'0h','% Complete':'0',Milestone:'true','Constraint Type':'ASAP','Unique ID':'102',ID:'2',GUID:randomUUID()}];
async function upload(p,rows){const bytes=writeCsv(rows,[...TASK_COLUMNS,...EXTRA_COLUMNS]);const form=new FormData();form.append('file',new Blob([bytes]),'project.csv');form.append('format','csv');const h=headers('PM');delete h['Content-Type'];h['Idempotency-Key']=randomUUID();const r=await fetch(BASE+`/projects/${p}/imports`,{method:'POST',headers:h,body:form});return{status:r.status,body:await r.json()};}
async function preview(p,j,rows){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/previews`,{method:'POST',headers:{...headers('PM'),'If-Match':String(j.version)},body:JSON.stringify({anchorKey:'guid:'+rows[1].GUID})});return{status:r.status,body:await r.json()};}
const sweep=(roles='Admin')=>api('POST','/internal/exchange/retention',{roles,body:{}});

test('P5 清理權限受限：非 Admin 不可觸發保存期限清理', async () => {
 assert.equal((await sweep('PM')).status,403);
 assert.equal((await sweep('Viewer')).status,403);
 assert.equal((await sweep('Admin')).status,201);
});

test('P5 過期不可變預覽清理：僅清過期、保留未過期；一般路徑仍不可改刪預覽', async () => {
 const p=await createProject(),rows=source();
 const u=await upload(p,rows);assert.equal(u.status,201);
 const v=await preview(p,u.body,rows);assert.equal(v.body.can_commit,true,JSON.stringify(v.body));
 const freshId=v.body.id;
 // 以 INSERT 造一筆過期預覽（INSERT 不受不可變觸發器限制）
 const expired=(await db().query(`INSERT INTO import_preview_versions(org_id,project_id,import_job_id,sequence_no,parser_version,payload,payload_hash,vector_hash,decision_hash,errors,warnings,created_by,expires_at) SELECT org_id,project_id,import_job_id,sequence_no+1,parser_version,payload,payload_hash,vector_hash,decision_hash,errors,warnings,created_by, now()-interval '1 day' FROM import_preview_versions WHERE id=$1 RETURNING id`,[freshId])).rows[0].id;
 // 一般使用者/路徑仍不可 UPDATE 或 DELETE 預覽（受限權限保障）
 await assert.rejects(db().query("UPDATE import_preview_versions SET errors='[]'::jsonb WHERE id=$1",[freshId]),/immutable/);
 await assert.rejects(db().query('DELETE FROM import_preview_versions WHERE id=$1',[freshId]),/immutable/);
 const before=(await db().query('SELECT count(*)::int n FROM import_preview_versions WHERE import_job_id=$1',[u.body.id])).rows[0].n;
 assert.equal(before,2);
 const s=await sweep();assert.equal(s.status,201,JSON.stringify(s.body));assert.ok(s.body.previews_deleted>=1);
 // 過期者刪除、未過期者保留
 assert.equal((await db().query('SELECT count(*)::int n FROM import_preview_versions WHERE id=$1',[expired])).rows[0].n,0);
 assert.equal((await db().query('SELECT count(*)::int n FROM import_preview_versions WHERE id=$1',[freshId])).rows[0].n,1);
});

test('P5 過期原檔／輸出清理：保留作業歷史與稽核，purged_at 冪等不重清，過期匯出不可下載', async () => {
 const p=await createProject(),rows=source();
 const u=await upload(p,rows);assert.equal(u.status,201);
 // 匯出一份，並把匯入與匯出都設為過期
 const ex=await fetch(BASE+`/projects/${p}/exports`,{method:'POST',headers:{...headers('PM'),'Idempotency-Key':randomUUID()},body:JSON.stringify({format:'csv'})});
 const ej=await ex.json();assert.equal(ex.status,201,JSON.stringify(ej));
 await db().query("UPDATE import_jobs SET expires_at=now()-interval '1 day' WHERE id=$1",[u.body.id]);
 await db().query("UPDATE export_jobs SET expires_at=now()-interval '1 day' WHERE id=$1",[ej.id]);
 const auditBefore=(await db().query("SELECT count(*)::int n FROM audit_logs WHERE org_id=$1 AND action='retention_sweep'",[ORG])).rows[0].n;
 const s=await sweep();assert.equal(s.status,201,JSON.stringify(s.body));
 assert.ok(s.body.import_files_purged>=1&&s.body.export_files_purged>=1,JSON.stringify(s.body));
 // 歷史保留：作業列仍在、purged_at 已標記
 const imp=(await db().query('SELECT purged_at FROM import_jobs WHERE id=$1',[u.body.id])).rows;
 assert.equal(imp.length,1);assert.ok(imp[0].purged_at,'import purged_at 已標記');
 const exp=(await db().query('SELECT purged_at FROM export_jobs WHERE id=$1',[ej.id])).rows;
 assert.equal(exp.length,1);assert.ok(exp[0].purged_at,'export purged_at 已標記');
 // 清理證據：稽核新增 retention_sweep
 assert.ok((await db().query("SELECT count(*)::int n FROM audit_logs WHERE org_id=$1 AND action='retention_sweep'",[ORG])).rows[0].n>auditBefore);
 // 匯入作業歷史仍可查
 assert.equal((await api('GET',`/projects/${p}/imports/${u.body.id}`)).status,200);
 // 過期匯出不可下載
 assert.equal((await api('GET',`/projects/${p}/exports/${ej.id}/download`)).status,409);
 // 冪等：再清一次不重複清這些已標記者
 const again=await sweep();assert.equal(again.status,201);
 assert.equal((await db().query("SELECT count(*)::int n FROM import_jobs WHERE id=$1 AND purged_at IS NOT NULL",[u.body.id])).rows[0].n,1);
});

test.after(()=>closeDb());
