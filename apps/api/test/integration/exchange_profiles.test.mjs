// P5 來源日曆／資源 profile 對照與差異（整合測試，真實 DB）：預覽明示差異供決策，不無聲修改組織設定。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {api,headers,BASE,createProject,db,closeDb,ORG} from './helpers.mjs';
const require=createRequire(import.meta.url);
const {writeXlsx}=require('../../dist/exchange/formats.js');
const {TASK_COLUMNS,EXTRA_COLUMNS}=require('../../dist/exchange/model.js');
const source=()=>[{'Task Name':'設計','WBS':'1','Outline Level':'1',Start:'2027-01-08T09:00+08:00',Finish:'2027-01-08T18:00+08:00',Duration:'1d',Predecessors:'','Resource Names':'',Work:'8h','% Complete':'0',Milestone:'false','Constraint Type':'ASAP','Unique ID':'101',ID:'1',GUID:randomUUID()},{'Task Name':'掛件','WBS':'0.0','Outline Level':'1',Start:'2027-01-11T18:00+08:00',Finish:'2027-01-11T18:00+08:00',Duration:'0d',Predecessors:'1FS','Resource Names':'',Work:'0h','% Complete':'0',Milestone:'true','Constraint Type':'ASAP','Unique ID':'102',ID:'2',GUID:randomUUID()}];

test('P5 預覽回傳來源日曆／資源 profile 與差異（時區、容量、未對應），不改組織設定', async () => {
 const p=await createProject();
 const resName='設備機組-'+randomUUID().slice(0,6);
 await db().query('INSERT INTO resources(id,org_id,code,name,type,max_units) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),ORG,'RC-'+randomUUID().slice(0,6),resName,'labor',1]);
 const sheets={
  Tasks:{columns:[...TASK_COLUMNS,...EXTRA_COLUMNS],rows:source()},
  Calendars:{columns:['Calendar Code','Name','Timezone','Hours Per Day','Parent Calendar Code'],rows:[
   {'Calendar Code':'C1',Name:'標準台北',Timezone:'America/New_York','Hours Per Day':'8','Parent Calendar Code':''},
   {'Calendar Code':'C2',Name:'未知月曆',Timezone:'Asia/Taipei','Hours Per Day':'8','Parent Calendar Code':''}]},
  Resources:{columns:['Resource GUID','Resource Code','Name','Type','Max Units','Base Week Minutes'],rows:[
   {'Resource GUID':'','Resource Code':'R1',Name:resName,Type:'labor','Max Units':'2','Base Week Minutes':''}]},
 };
 const bytes=await writeXlsx(sheets);
 const form=new FormData();form.append('file',new Blob([bytes]),'project.xlsx');form.append('format','xlsx');
 const h=headers('PM');delete h['Content-Type'];h['Idempotency-Key']=randomUUID();
 const u=await (await fetch(BASE+`/projects/${p}/imports`,{method:'POST',headers:h,body:form})).json();
 // profiles 於預覽計算，與 can_commit 無關（此處只驗證差異結構與不改組織設定）
 const preview=await (await fetch(BASE+`/projects/${p}/imports/${u.id}/previews`,{method:'POST',headers:{...headers('PM'),'If-Match':String(u.version)},body:JSON.stringify({})})).json();
 assert.ok(preview.profiles,'預覽含 profiles');
 const c1=preview.profiles.calendars.find(c=>c.code==='C1');assert.ok(c1,'含 C1 日曆 profile');
 assert.ok(c1.target&&c1.target.name==='標準台北','C1 依名稱對應到組織標準台北');
 assert.ok(c1.differences.includes('timezone'),'時區差異被明示');
 const c2=preview.profiles.calendars.find(c=>c.code==='C2');assert.ok(c2.differences.includes('unmapped'),'未知月曆標示未對應');
 const r1=preview.profiles.resources.find(r=>r.name===resName);assert.ok(r1,'含來源資源 profile');
 assert.ok(r1.target&&r1.differences.includes('capacity'),'Max Units 容量差異被明示');
 // 不無聲修改組織設定：目標日曆時區與資源容量維持原值
 assert.equal((await db().query("SELECT timezone FROM calendars WHERE name='標準台北' AND org_id=$1",[ORG])).rows[0].timezone,'Asia/Taipei');
 assert.equal(Number((await db().query('SELECT max_units FROM resources WHERE name=$1 AND org_id=$2',[resName,ORG])).rows[0].max_units),1);
});

test.after(()=>closeDb());
