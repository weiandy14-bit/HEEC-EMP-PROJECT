// P5-11 MSP XML 技術閘門（純解析，無 DB）：ConstraintType 0..7、LinkLag 十分之一分鐘、
// 小數分鐘精度拒絕、DTD/XXE 拒絕、跨案拒絕，以及 write→read 核心 round-trip。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {readMspXml,writeMspXml,isoDurationToMinutes}=require('../../dist/exchange/msp-xml.js');
const {parseExchange}=require('../../dist/exchange/parser.js');
const {TASK_COLUMNS,EXTRA_COLUMNS}=require('../../dist/exchange/model.js');
const opts={format:'xml',timezone:'Asia/Taipei',hoursPerDay:8,maxNegativeLagMinutes:14400};
const project=(tasks,extra='')=>`<?xml version="1.0" encoding="UTF-8"?>\n<Project xmlns="http://schemas.microsoft.com/project">${extra}<Tasks>${tasks}</Tasks></Project>`;
const task=(f)=>`<Task><UID>${f.uid}</UID>${f.guid?`<GUID>${f.guid}</GUID>`:''}<Name>${f.name}</Name><WBS>${f.wbs}</WBS><OutlineLevel>${f.ol}</OutlineLevel><Duration>${f.dur??'PT8H0M0S'}</Duration><Work>${f.work??'PT0H0M0S'}</Work><Milestone>${f.ms??0}</Milestone>${f.ct!==undefined?`<ConstraintType>${f.ct}</ConstraintType>`:''}${f.cd?`<ConstraintDate>${f.cd}</ConstraintDate>`:''}${f.extra??''}</Task>`;
const errCode=(code)=>(e)=>e&&e.code===code;

test('P5-11 ConstraintType 0..7 映射 ASAP/ALAP/MSO/MFO/SNET/SNLT/FNET/FNLT', async () => {
 const names=['ASAP','ALAP','MSO','MFO','SNET','SNLT','FNET','FNLT'];
 for(let i=0;i<8;i++){
  const xml=project(task({uid:'1',name:'T',wbs:'1',ol:'1',ct:i,cd:i>1?'2027-01-10T08:00:00':''}));
  const parsed=await parseExchange(Buffer.from(xml),opts);
  assert.deepEqual(parsed.issues.filter(x=>x.severity==='error'),[],`ct ${i}: ${JSON.stringify(parsed.issues)}`);
  assert.equal(parsed.tasks[0].constraint,names[i]);
 }
});

test('P5-11 PredecessorLink Type→關係、LinkLag 十分之一分鐘：-40 → -4 分鐘', async () => {
 const pred='<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>-40</LinkLag><LinkLagFormat>7</LinkLagFormat></PredecessorLink>';
 const xml=project(task({uid:'1',name:'A',wbs:'1',ol:'1',ct:0})+task({uid:'2',name:'B',wbs:'2',ol:'1',ct:0,extra:pred}));
 const parsed=await parseExchange(Buffer.from(xml),opts);
 assert.deepEqual(parsed.issues.filter(x=>x.severity==='error'),[],JSON.stringify(parsed.issues));
 assert.equal(parsed.dependencies.length,1);
 assert.equal(parsed.dependencies[0].relation,'FS');
 assert.equal(parsed.dependencies[0].lag,-4);
 // Type 0/2/3 → FF/SF/SS
 for(const [type,rel] of [['0','FF'],['2','SF'],['3','SS']]){
  const p2=await parseExchange(Buffer.from(project(task({uid:'1',name:'A',wbs:'1',ol:'1',ct:0})+task({uid:'2',name:'B',wbs:'2',ol:'1',ct:0,extra:`<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>${type}</Type><LinkLag>0</LinkLag></PredecessorLink>`}))),opts);
  assert.equal(p2.dependencies[0].relation,rel);
 }
});

test('P5-11 小數分鐘精度不支援須報告，不靜默截斷', () => {
 assert.throws(()=>readMspXml(Buffer.from(project(task({uid:'1',name:'A',wbs:'1',ol:'1',dur:'PT0H0M30S'})))),errCode('xml_precision'));
 assert.equal(isoDurationToMinutes('PT8H30M0S'),'510min');
 assert.equal(isoDurationToMinutes('-PT0H4M0S'),'-4min');
});

test('P5-11 安全：拒絕 DTD、外部/未知實體（XXE 防護）', () => {
 assert.throws(()=>readMspXml(Buffer.from('<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "y">]><Project xmlns="x"><Tasks></Tasks></Project>')),errCode('xml_dtd_forbidden'));
 assert.throws(()=>readMspXml(Buffer.from('<?xml version="1.0"?><Project xmlns="x"><Tasks><Task><UID>1</UID><Name>&xxe;</Name></Task></Tasks></Project>')),errCode('xml_entity_forbidden'));
});

test('P5-11 跨案拒絕：ExternalTask 與 SubProjects', () => {
 assert.throws(()=>readMspXml(Buffer.from(project(task({uid:'1',name:'A',wbs:'1',ol:'1',extra:'<ExternalTask>1</ExternalTask>'})))),errCode('cross_project'));
 assert.throws(()=>readMspXml(Buffer.from(project(task({uid:'1',name:'A',wbs:'1',ol:'1'}),'<SubProjects><SubProject/></SubProjects>'))),errCode('cross_project'));
});

test('P5-11 write→read 核心 round-trip：UID、Duration、Constraint、Predecessor lag 保存', () => {
 const rows=[
  {'Task Name':'設計',WBS:'1','Outline Level':'1',Start:'',Finish:'',Duration:'480min',Predecessors:'',Work:'0min','% Complete':'0',Milestone:'false',Summary:'false','Constraint Type':'SNET','Unique ID':'10',ID:'10',GUID:''},
  {'Task Name':'B',WBS:'2','Outline Level':'1',Start:'',Finish:'',Duration:'480min',Predecessors:'10FS-4min',Work:'0min','% Complete':'0',Milestone:'false',Summary:'false','Constraint Type':'ASAP','Unique ID':'11',ID:'11',GUID:''},
 ];
 const xml=writeMspXml({Tasks:{columns:[...TASK_COLUMNS,...EXTRA_COLUMNS],rows}});
 const back=readMspXml(xml);
 assert.equal(back.Tasks.length,2);
 assert.equal(back.Tasks[0]['Unique ID'],'10');
 assert.equal(back.Tasks[0]['Constraint Type'],'SNET');
 assert.equal(back.Tasks[0].Duration,'480min');
 assert.equal(back.Tasks[1].Predecessors,'10FS-4min');
});
