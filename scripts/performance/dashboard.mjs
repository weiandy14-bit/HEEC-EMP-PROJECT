// Real PostgreSQL + HTTP + Chromium evidence; generated data is isolated by org UUID.
import 'reflect-metadata';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {cpus,totalmem,platform} from 'node:os';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const require=createRequire(import.meta.url);
const {GanttService}=require('../../apps/api/dist/dashboard/gantt.service.js');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const BASE=process.env.BASE??'http://localhost:3000/api/v1';
const org=randomUUID(),user=randomUUID(),cal=randomUUID();
const out='performance-results';await mkdir(out,{recursive:true});
const report={timestamp:new Date().toISOString(),commit:process.env.GITHUB_SHA??null,hardware:{platform:platform(),cpu:cpus()[0]?.model,vcpus:cpus().length,total_memory_bytes:totalmem()},org,datasets:[]};
const headers={'X-Org-Id':org,'X-User-Id':user,'X-Roles':'PM','Content-Type':'application/json'};
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
let vite,browser;
async function seedProjects(count,start=0){
 const rows=[];
 for(let i=start;i<start+count;i++)rows.push({id:randomUUID(),root:randomUUID(),code:`PERF-${String(i).padStart(4,'0')}`});
 await pool.query(`INSERT INTO projects(id,org_id,code,name,status,permit_filing_date,default_calendar_id,pm_user_id,created_by)
 SELECT x.id,$1,x.code,'Benchmark '||x.code,'active','2027-04-01',$2,$3,$3 FROM jsonb_to_recordset($4::jsonb)x(id uuid,code text)`,[org,cal,user,JSON.stringify(rows)]);
 await pool.query(`INSERT INTO project_tasks(id,org_id,project_id,wbs_code,sort_key,name,summary,planned_start,planned_finish)
 SELECT x.root,$1,x.id,'0','00000','Design package',true,'2027-03-01T01:00Z','2027-03-31T10:00Z' FROM jsonb_to_recordset($2::jsonb)x(id uuid,root uuid)`,[org,JSON.stringify(rows)]);
 return rows;
}
async function seedTasks(projects,first,last){
 for(let i=0;i<projects.length;i+=20){
  await pool.query(`INSERT INTO project_tasks(org_id,project_id,parent_task_id,wbs_code,sort_key,name,duration_minutes,planned_start,planned_finish,critical)
   SELECT $1,x.id,x.root,n::text,lpad(n::text,5,'0'),'Work '||n,480,'2027-03-01T01:00Z','2027-03-02T10:00Z',n%10=0 FROM jsonb_to_recordset($2::jsonb)x(id uuid,root uuid) CROSS JOIN generate_series($3::int,$4::int)n`,[org,JSON.stringify(projects.slice(i,i+20)),first,last]);
  console.log(`seed ${i+Math.min(20,projects.length-i)}/${projects.length} projects, tasks ${first}..${last}`);
 }
}
async function sample(path,count=20){
 const times=[];let bytes=0,body;
 for(let i=0;i<count;i++){const start=performance.now();const r=await fetch(BASE+path,{headers});const text=await r.text();assert.equal(r.status,200,text.slice(0,400));body=JSON.parse(text);times.push(performance.now()-start);bytes=Buffer.byteLength(text);}
 return {p95_ms:p95(times),min_ms:Math.min(...times),max_ms:Math.max(...times),samples_ms:times,response_bytes:bytes,body};
}
async function browserSamples(label){
 const metrics=[];
 for(const viewport of [{width:1280,height:720},{width:1920,height:1080}]){
  const page=await browser.newPage({viewport});const timings=[];
  for(let i=0;i<20;i++){const start=performance.now();await page.goto('http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});await page.getByTestId('task-row').first().waitFor({state:'visible'});await page.waitForFunction(()=>!!document.querySelector('[data-testid="filter-project"] option[value]'));timings.push(performance.now()-start);assert.ok(await page.getByTestId('task-row').count()<80);}
  await page.screenshot({path:`${out}/${label}-${viewport.width}.png`});metrics.push({viewport,p95_ms:p95(timings),cold_ms:timings[0],samples_ms:timings});await page.close();
 }
 return metrics;
}
async function plans(label){
 const queries=[];
 const db={query:async(sql,params)=>{queries.push({sql,params});return(await pool.query(sql,params)).rows;}};
 const service=new GanttService(db),ctx={orgId:org,userId:user,roles:['PM']};
 await service.portfolio(ctx,{limit:50,task_limit:200});
 const plans=[];for(const query of queries){const r=await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query.sql,query.params);plans.push({sql:query.sql,parameters:query.params,plan:r.rows[0]['QUERY PLAN']});}
 await writeFile(`${out}/${label}-explain.json`,JSON.stringify(plans,null,2));
 const many=queries.length;queries.length=0;await service.portfolio(ctx,{limit:1,task_limit:200});assert.equal(queries.length,many,'query count independent of project count');
 return many;
}
try{
 report.postgres=(await pool.query('SELECT version()')).rows[0].version;
 await pool.query(`INSERT INTO organizations(id,code,name) VALUES($1,$2,'Dashboard performance')`,[org,'PERF-'+org]);
 await pool.query(`INSERT INTO users(id,org_id,issuer,subject,email,display_name) VALUES($1,$2,'perf',$1::text,'perf@example.invalid','Benchmark PM')`,[user,org]);
 await pool.query(`INSERT INTO calendars(id,org_id,name,timezone) VALUES($1,$2,'Performance calendar','Asia/Taipei')`,[cal,org]);
 await pool.query(`INSERT INTO calendar_working_days(org_id,calendar_id,weekday,local_start,local_end) SELECT $1,$2,d,start_at::time,end_at::time FROM generate_series(1,5)d CROSS JOIN (VALUES('09:00','12:00'),('13:00','18:00'))w(start_at,end_at)`,[org,cal]);
 const typical=await seedProjects(50);await seedTasks(typical,1,99);
 vite=spawn(process.execPath,['../../node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4175','--strictPort'],{cwd:'apps/web',env:{...process.env,VITE_API_TARGET:BASE.replace('/api/v1',''),VITE_DEV_ORG:org,VITE_DEV_USER:user,VITE_DEV_ROLES:'PM'},stdio:['ignore','pipe','pipe']});
 vite.stdout.on('data',d=>process.stdout.write(d));vite.stderr.on('data',d=>process.stderr.write(d));
 for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:4175/');break;}catch{await new Promise(r=>setTimeout(r,500));}}
 browser=await chromium.launch({headless:true});
 const first=await sample('/dashboard/gantt?limit=50');assert.equal(first.body.projects.length,50);assert.equal(first.body.projects.reduce((n,p)=>n+p.tasks.length,0),5000);
 const typicalBrowser=await browserSamples('typical');
 report.datasets.push({label:'typical',projects:50,tasks_per_project:100,total_tasks:5000,api:{...first,body:undefined},browser:typicalBrowser,query_count:await plans('typical')});
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 assert.ok(first.p95_ms<3000,'typical 50-project API P95 under 3 seconds');assert.ok(typicalBrowser.every(m=>m.p95_ms<3000),'typical 50-project browser first-screen P95 under 3 seconds');
 const more=await seedProjects(450,50);await seedTasks(typical,100,4999);await seedTasks(more,1,4999);
 await pool.query('ANALYZE projects');await pool.query('ANALYZE project_tasks');await pool.query('ANALYZE baselines');await pool.query('ANALYZE baseline_tasks');
 // Include active Baseline and dependency edges in the large-data read plan.
 const baseline=(await pool.query(`INSERT INTO baselines(org_id,project_id,sequence_no,created_from_schedule_version,status) VALUES($1,$2,1,0,'active') RETURNING id`,[org,typical[0].id])).rows[0].id;
 await pool.query(`INSERT INTO baseline_tasks(baseline_id,task_id,start_at,finish_at,task_name,wbs_code) SELECT $1,id,planned_start,planned_finish,name,wbs_code FROM project_tasks WHERE project_id=$2`,[baseline,typical[0].id]);
 await pool.query(`INSERT INTO task_dependencies(org_id,project_id,predecessor_task_id,successor_task_id,relation) SELECT $1,$2,$3,id,'FS' FROM project_tasks WHERE project_id=$2 AND summary=false`,[org,typical[0].id,typical[0].root]);
 const large=await sample('/dashboard/gantt?limit=50');assert.equal(large.body.projects.length,50);assert.ok(large.body.projects.every(p=>p.task_next_cursor));
 let cursor=null;const seen=new Set();let pages=0;
 do{const r=await sample(`/dashboard/gantt?project_id=${typical[0].id}&task_limit=1000${cursor?'&task_cursor='+cursor:''}`,1);r.body.projects[0].tasks.forEach(t=>seen.add(t.id));cursor=r.body.projects[0].task_next_cursor;pages++;assert.ok(pages<=6);}while(cursor);
 assert.equal(seen.size,5000);
 const largeBrowser=await browserSamples('large');
 report.datasets.push({label:'large',projects:500,tasks_per_project:5000,total_tasks:2500000,read_scope:'50 projects x 200 candidates + ancestors + touching dependencies',api:{...large,body:undefined},browser:largeBrowser,query_count:await plans('large'),single_project_paging:{tasks_seen:seen.size,pages}});
 assert.equal((await pool.query(`SELECT count(*)::int AS n FROM project_tasks WHERE org_id=$1`,[org])).rows[0].n,2500000);
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.datasets.map(({label,api,browser,query_count})=>({label,api_p95_ms:api.p95_ms,browser_p95_ms:browser.map(b=>b.p95_ms),query_count})),null,2));
}catch(e){report.error=String(e.stack??e);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));throw e;}
finally{await browser?.close();vite?.kill();await pool.end();}
