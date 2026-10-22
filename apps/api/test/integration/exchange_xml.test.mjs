// P5-11 MSP XML 端到端：匯入 XML → 提交 → 匯出 XML → 匯入隔離案件，驗證圖等價（真實 DB）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {api,headers,BASE,createProject,db,closeDb} from './helpers.mjs';
const require=createRequire(import.meta.url);
const {parseExchange}=require('../../dist/exchange/parser.js');

// 掛件錨點日期 = 案件 permit_filing_date 2027-01-11 的 18:00（台北）
const mspXml=()=>`<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project"><Tasks>
<Task><UID>101</UID><Name>設計</Name><WBS>1</WBS><OutlineLevel>1</OutlineLevel><Start>2027-01-08T09:00:00</Start><Finish>2027-01-08T18:00:00</Finish><Duration>PT8H0M0S</Duration><Work>PT0H0M0S</Work><PercentComplete>0</PercentComplete><Milestone>0</Milestone><Summary>0</Summary><ConstraintType>0</ConstraintType></Task>
<Task><UID>102</UID><Name>掛件</Name><WBS>0.0</WBS><OutlineLevel>1</OutlineLevel><Start>2027-01-11T18:00:00</Start><Finish>2027-01-11T18:00:00</Finish><Duration>PT0H0M0S</Duration><Work>PT0H0M0S</Work><PercentComplete>0</PercentComplete><Milestone>1</Milestone><Summary>0</Summary><ConstraintType>0</ConstraintType><PredecessorLink><PredecessorUID>101</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink></Task>
</Tasks></Project>`;
async function uploadXml(p,bytes,timezone){const form=new FormData();form.append('file',new Blob([bytes]),'project.xml');form.append('format','xml');if(timezone)form.append('timezone',timezone);const h=headers('PM');delete h['Content-Type'];h['Idempotency-Key']=randomUUID();const r=await fetch(BASE+`/projects/${p}/imports`,{method:'POST',headers:h,body:form});return{status:r.status,body:await r.json()};}
async function preview(p,j,anchorKey='uid:102'){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/previews`,{method:'POST',headers:{...headers('PM'),'If-Match':String(j.version)},body:JSON.stringify({anchorKey})});return{status:r.status,body:await r.json()};}
async function commit(p,j,v){const r=await fetch(BASE+`/projects/${p}/imports/${j.id}/commit`,{method:'POST',headers:{...headers('PM'),'If-Match':String(v.job_version),'Idempotency-Key':randomUUID()},body:JSON.stringify({previewId:v.id,previewHash:v.payload_hash})});return{status:r.status,body:await r.json()};}

test('P5-11 MSP XML 匯入→提交→匯出→再匯入隔離案件，工作圖等價', async () => {
 const p=await createProject();
 const u=await uploadXml(p,Buffer.from(mspXml(),'utf8'));
 assert.equal(u.status,201,JSON.stringify(u.body));assert.equal(u.body.scan_state,'clean');
 const v=await preview(p,u.body);
 assert.equal(v.body.can_commit,true,JSON.stringify(v.body.issues));
 const done=await commit(p,u.body,v.body);assert.equal(done.body.state,'succeeded',JSON.stringify(done.body));
 assert.equal((await db().query('SELECT count(*)::int n FROM project_tasks WHERE project_id=$1',[p])).rows[0].n,2);
 assert.equal((await db().query('SELECT count(*)::int n FROM task_dependencies WHERE project_id=$1 AND archived_at IS NULL',[p])).rows[0].n,1);
 // 匯出 XML
 const r=await fetch(BASE+`/projects/${p}/exports`,{method:'POST',headers:{...headers('PM'),'Idempotency-Key':randomUUID()},body:JSON.stringify({format:'xml'})});
 const e=await r.json();assert.equal(r.status,201,JSON.stringify(e));
 const file=await fetch(BASE+`/projects/${p}/exports/${e.id}/download`,{headers:headers('PM')});
 assert.equal(file.status,200);assert.match(file.headers.get('content-type'),/xml/);
 const xmlBytes=Buffer.from(await file.arrayBuffer());
 // 匯出 XML 可被解析器重讀，UID/關係保留
 const parsed=await parseExchange(xmlBytes,{format:'xml',timezone:'Asia/Taipei',hoursPerDay:8,maxNegativeLagMinutes:14400});
 assert.deepEqual(parsed.issues.filter(x=>x.severity==='error'),[],JSON.stringify(parsed.issues));
 assert.equal(parsed.tasks.length,2);assert.equal(parsed.dependencies.length,1);assert.equal(parsed.dependencies[0].relation,'FS');
 // 再匯入隔離案件，圖等價
 const p2=await createProject();
 const anchorKey2=parsed.tasks.find(t=>t.milestone).key; // 匯出以內部 UUID 作 GUID，重讀錨點改以 guid: 鍵識別
 const u2=await uploadXml(p2,xmlBytes,'UTC');assert.equal(u2.status,201,JSON.stringify(u2.body));
 const v2=await preview(p2,u2.body,anchorKey2);assert.equal(v2.body.can_commit,true,JSON.stringify(v2.body.issues));
 const done2=await commit(p2,u2.body,v2.body);assert.equal(done2.body.state,'succeeded',JSON.stringify(done2.body));
 assert.equal((await db().query('SELECT count(*)::int n FROM project_tasks WHERE project_id=$1',[p2])).rows[0].n,2);
 assert.equal((await db().query('SELECT count(*)::int n FROM task_dependencies WHERE project_id=$1 AND archived_at IS NULL',[p2])).rows[0].n,1);
});

test.after(()=>closeDb());
