// Microsoft Project XML Data Interchange adapter. Secure by construction: no DTD/ENTITY,
// no external entity resolution, bounded depth/size. Maps to/from the canonical exchange sheets
// so the existing normalizer, validation and round-trip apply unchanged.
// Refs: ConstraintType 0..7 → ASAP/ALAP/MSO/MFO/SNET/SNLT/FNET/FNLT; PredecessorLink.Type
// 0=FF,1=FS,2=SF,3=SS; LinkLag is tenths-of-a-minute (−40 → −4 minutes).
import {ExchangeParseError,LIMITS,TASK_COLUMNS,EXTRA_COLUMNS,type SheetRow} from './model';

const CONSTRAINTS=['ASAP','ALAP','MSO','MFO','SNET','SNLT','FNET','FNLT'];
const REL=['FF','FS','SF','SS']; // MSP PredecessorLink.Type order
const MAX_DEPTH=200;

interface XNode{name:string;children:XNode[];text:string}
const stripNs=(s:string)=>{const i=s.indexOf(':');return i<0?s:s.slice(i+1);};
function decodeEntities(s:string){return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,(_m,e)=>{const l=e.toLowerCase();if(l==='lt')return '<';if(l==='gt')return '>';if(l==='amp')return '&';if(l==='quot')return '"';if(l==='apos')return "'";if(e[0]==='#'){const code=e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);if(Number.isFinite(code)&&code>0&&code<=0x10ffff)return String.fromCodePoint(code);}throw new ExchangeParseError('xml_entity_forbidden','不接受外部或未知 XML 實體');});}

/** Minimal, hardened XML → tree. Rejects DOCTYPE/ENTITY and any external/unknown entity. */
function parseXml(text:string):XNode{
 if(/<!DOCTYPE/i.test(text)||/<!ENTITY/i.test(text)||/<!\[INCLUDE|<!\[IGNORE/i.test(text))throw new ExchangeParseError('xml_dtd_forbidden','不接受 DTD／實體定義（XXE 防護）');
 if(text.includes('\0'))throw new ExchangeParseError('xml_invalid','XML 不可包含 NUL');
 const root:XNode={name:'#root',children:[],text:''};const stack=[root];let i=0;const n=text.length;let depth=0;
 while(i<n){
  if(text[i]==='<'){
   if(text.startsWith('<?',i)){const e=text.indexOf('?>',i);if(e<0)throw new ExchangeParseError('xml_invalid','處理指令未結束');i=e+2;continue;}
   if(text.startsWith('<!--',i)){const e=text.indexOf('-->',i);if(e<0)throw new ExchangeParseError('xml_invalid','註解未結束');i=e+3;continue;}
   if(text.startsWith('<![CDATA[',i)){const e=text.indexOf(']]>',i);if(e<0)throw new ExchangeParseError('xml_invalid','CDATA 未結束');stack[stack.length-1].text+=text.slice(i+9,e);i=e+3;continue;}
   if(text[i+1]==='/'){const e=text.indexOf('>',i);if(e<0)throw new ExchangeParseError('xml_invalid','結束標籤未結束');const name=stripNs(text.slice(i+2,e).trim());const top=stack.pop();if(!top||top.name!==name)throw new ExchangeParseError('xml_invalid','XML 標籤不配對');depth--;i=e+1;continue;}
   const e=text.indexOf('>',i);if(e<0)throw new ExchangeParseError('xml_invalid','起始標籤未結束');
   let raw=text.slice(i+1,e);const selfClose=raw.endsWith('/');if(selfClose)raw=raw.replace(/\/$/,'');
   const sp=raw.search(/[\s]/);const name=stripNs((sp<0?raw:raw.slice(0,sp)).trim());
   if(!name)throw new ExchangeParseError('xml_invalid','空標籤名');
   const node:XNode={name,children:[],text:''};stack[stack.length-1].children.push(node);
   if(!selfClose){stack.push(node);if(++depth>MAX_DEPTH)throw new ExchangeParseError('xml_depth','XML 節點深度超限');}
   i=e+1;continue;
  }
  const lt=text.indexOf('<',i);const end=lt<0?n:lt;const chunk=text.slice(i,end);if(chunk.trim())stack[stack.length-1].text+=decodeEntities(chunk);i=end;
 }
 if(stack.length!==1)throw new ExchangeParseError('xml_invalid','XML 標籤未全部閉合');
 return root;
}
const kids=(node:XNode,name:string)=>node.children.filter(c=>c.name===name);
const kid=(node:XNode,name:string)=>node.children.find(c=>c.name===name);
const txt=(node:XNode|undefined,name:string)=>{const c=node&&kid(node,name);return c?c.text.trim():'';};

/** ISO-8601 PnYnMnDTnHnMnS (MSP uses PTnHnMnS) → integer-minute 'Nmin'; reject sub-minute precision. */
export function isoDurationToMinutes(d:string):string{
 if(!d.trim())return '';const m=/^(-)?PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(d.trim());
 if(!m||(!m[2]&&!m[3]&&!m[4]))throw new ExchangeParseError('xml_duration','不支援的工期格式，需 ISO-8601 PTnHnMnS');
 const sign=m[1]?-1:1,h=Number(m[2]||0),mi=Number(m[3]||0),s=Number(m[4]||0);const total=sign*(h*60+mi+s/60);
 if(!Number.isInteger(total))throw new ExchangeParseError('xml_precision','不支援小數分鐘精度，請改用整分鐘工期');
 return total+'min';
}
function minutesToIso(value:string):string{ // 'Nmin' → PTnHnMnS
 if(!value.trim())return '';const m=/^(-?\d+)min$/.exec(value.trim());if(!m)return value;let n=Number(m[1]);const neg=n<0;n=Math.abs(n);return (neg?'-':'')+`PT${Math.floor(n/60)}H${n%60}M0S`;}

/** MSP XML → canonical sheets (Tasks/Assignments/Resources/Calendars). */
export function readMspXml(bytes:Buffer):Record<string,SheetRow[]>{
 if(bytes.length>LIMITS.bytes)throw new ExchangeParseError('file_limit','檔案超過10 MiB');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ExchangeParseError('encoding_invalid','MSP XML 需 UTF-8');}
 const root=parseXml(text);
 const project=kid(root,'Project');if(!project)throw new ExchangeParseError('xml_invalid','缺少 Project 根節點');
 if(kid(project,'SubProjects')||kid(project,'ExternalTask'))throw new ExchangeParseError('cross_project','不接受跨案 SubProject／ExternalTask');
 const tasks:SheetRow[]=[];const taskNodes=kids(kid(project,'Tasks')??{name:'',children:[],text:''},'Task');
 if(taskNodes.length>LIMITS.tasks)throw new ExchangeParseError('row_limit','單案最多5,000個工作');
 for(const t of taskNodes){
  if(txt(t,'ExternalTask')==='1'||txt(t,'ExternalUID')||txt(t,'SubprojectName'))throw new ExchangeParseError('cross_project','不接受跨案外部工作');
  const uid=txt(t,'UID');if(!uid)throw new ExchangeParseError('identity_missing','Task 缺少 UID');
  const ct=txt(t,'ConstraintType');
  const preds=kids(t,'PredecessorLink').map(l=>{
   const puid=txt(l,'PredecessorUID');if(!puid)throw new ExchangeParseError('predecessor_invalid','PredecessorLink 缺 PredecessorUID');
   const type=txt(l,'Type');const rel=REL[Number(type)]??'FS';
   const lagRaw=txt(l,'LinkLag');let lagToken='';
   if(lagRaw&&lagRaw!=='0'){const tenths=Number(lagRaw);if(!Number.isFinite(tenths))throw new ExchangeParseError('lag_invalid','LinkLag 非數值');const minutes=tenths/10;lagToken=(minutes>0?'+':'')+ (Number.isInteger(minutes)?minutes:minutes) +'min';}
   return puid+rel+lagToken;
  }).join(';');
  const row:SheetRow=Object.create(null);
  row['Task Name']=txt(t,'Name');row.WBS=txt(t,'WBS');row['Outline Level']=txt(t,'OutlineLevel');
  row.Start=normDate(txt(t,'Start'));row.Finish=normDate(txt(t,'Finish'));
  row.Duration=isoDurationToMinutes(txt(t,'Duration'));row.Work=isoDurationToMinutes(txt(t,'Work'));
  row.Predecessors=preds;row['Resource Names']='';
  row['% Complete']=txt(t,'PercentComplete')||'0';
  row['Baseline Start']=normDate(txt(kid(t,'Baseline'),'Start'));row['Baseline Finish']=normDate(txt(kid(t,'Baseline'),'Finish'));
  row.Milestone=txt(t,'Milestone')==='1'?'true':'false';row.Summary=txt(t,'Summary')==='1'?'true':'false';
  row['Constraint Type']=ct&&CONSTRAINTS[Number(ct)]?CONSTRAINTS[Number(ct)]:(ct||'');
  row['Constraint Date']=normDate(txt(t,'ConstraintDate'));row.Notes=txt(t,'Notes');
  row['Unique ID']=uid;row.ID=uid;row.GUID=txt(t,'GUID');
  row['Actual Start']=normDate(txt(t,'ActualStart'));row['Actual Finish']=normDate(txt(t,'ActualFinish'));
  tasks.push(row);
 }
 const resources:SheetRow[]=kids(kid(project,'Resources')??{name:'',children:[],text:''},'Resource').filter(r=>txt(r,'Name')).map(r=>({'Resource GUID':txt(r,'GUID'),'Resource Code':txt(r,'UID'),Name:txt(r,'Name'),Type:txt(r,'Type')==='1'?'labor':'material','Max Units':txt(r,'MaxUnits')||'1','Base Week Minutes':''}));
 const assignments:SheetRow[]=kids(kid(project,'Assignments')??{name:'',children:[],text:''},'Assignment').map(a=>({'Task UID':txt(a,'TaskUID'),'Resource Code':txt(a,'ResourceUID'),'Resource GUID':'',Units:txt(a,'Units')||'1','Planned Work':isoDurationToMinutes(txt(a,'Work')),'Actual Work':isoDurationToMinutes(txt(a,'ActualWork')),'Remaining Work':'',Start:normDate(txt(a,'Start')),Finish:normDate(txt(a,'Finish')),'Booking Type':'committed',Contour:''}));
 const sheets:Record<string,SheetRow[]>={Tasks:tasks};
 if(resources.length)sheets.Resources=resources;
 if(assignments.length)sheets.Assignments=assignments;
 return sheets;
}
function normDate(v:string):string{if(!v.trim())return '';return v.trim();} // MSP local datetime; timezone applied by parser options

const esc=(s:string)=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c] as string));
/** Canonical sheets → MSP XML. Inverse of readMspXml for the core task graph. */
export function writeMspXml(sheets:Record<string,{columns:string[];rows:SheetRow[]}>):Buffer{
 const tasks=sheets.Tasks?.rows??[];const uidOf=(r:SheetRow)=>r['Unique ID']||r.ID||'';
 // Predecessors in the canonical sheet reference the ID column; MSP links reference UID. Map so <UID> and PredecessorUID agree.
 const idToUid=new Map(tasks.map(r=>[r.ID,uidOf(r)]));
 const taskXml=tasks.map(r=>{
  const preds=(r.Predecessors??'').split(';').map(s=>s.trim()).filter(Boolean).map(tok=>{const m=/^(\d+)(FF|FS|SF|SS)?([+-]\d+(?:\.\d+)?min)?$/.exec(tok);if(!m)return '';const type=m[2]?REL.indexOf(m[2]):1;const lagMin=m[3]?Number(m[3].replace('min','')):0;const tenths=Math.round(lagMin*10);return `<PredecessorLink><PredecessorUID>${esc(idToUid.get(m[1])??m[1])}</PredecessorUID><Type>${type}</Type><LinkLag>${tenths}</LinkLag><LinkLagFormat>7</LinkLagFormat></PredecessorLink>`;}).join('');
  const ctName=r['Constraint Type']||'';const ct=CONSTRAINTS.indexOf(ctName);const ctNum=ct>=0?ct:0;
  const dt=(v:string)=>v?`${v}`.replace(/Z$/,'').replace(/(\.\d+)?(?:[+-]\d\d:\d\d)?$/,''):'';
  return `<Task><UID>${esc(uidOf(r))}</UID>${r.GUID?`<GUID>${esc(r.GUID)}</GUID>`:''}<Name>${esc(r['Task Name'])}</Name><WBS>${esc(r.WBS)}</WBS><OutlineLevel>${esc(r['Outline Level'])}</OutlineLevel><Start>${esc(dt(r.Start))}</Start><Finish>${esc(dt(r.Finish))}</Finish><Duration>${esc(minutesToIso(r.Duration))}</Duration><Work>${esc(minutesToIso(r.Work))}</Work><PercentComplete>${esc(r['% Complete']||'0')}</PercentComplete><Milestone>${r.Milestone==='true'?1:0}</Milestone><Summary>${r.Summary==='true'?1:0}</Summary><ConstraintType>${ctNum}</ConstraintType>${r['Constraint Date']?`<ConstraintDate>${esc(dt(r['Constraint Date']))}</ConstraintDate>`:''}${r.Notes?`<Notes>${esc(r.Notes)}</Notes>`:''}${r['Baseline Start']?`<Baseline><Number>0</Number><Start>${esc(dt(r['Baseline Start']))}</Start><Finish>${esc(dt(r['Baseline Finish']))}</Finish></Baseline>`:''}${preds}</Task>`;
 }).join('');
 const resources=(sheets.Resources?.rows??[]).map(r=>`<Resource><UID>${esc(r['Resource Code'])}</UID>${r['Resource GUID']?`<GUID>${esc(r['Resource GUID'])}</GUID>`:''}<Name>${esc(r.Name)}</Name><Type>${r.Type==='labor'?1:0}</Type><MaxUnits>${esc(r['Max Units']||'1')}</MaxUnits></Resource>`).join('');
 const assignments=(sheets.Assignments?.rows??[]).map(a=>`<Assignment><TaskUID>${esc(a['Task UID'])}</TaskUID><ResourceUID>${esc(a['Resource Code'])}</ResourceUID><Units>${esc(a.Units||'1')}</Units><Work>${esc(minutesToIso(a['Planned Work']))}</Work></Assignment>`).join('');
 const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<Project xmlns="http://schemas.microsoft.com/project"><Tasks>${taskXml}</Tasks>${resources?`<Resources>${resources}</Resources>`:''}${assignments?`<Assignments>${assignments}</Assignments>`:''}</Project>\n`;
 const buffer=Buffer.from(xml,'utf8');if(buffer.length>LIMITS.bytes)throw new ExchangeParseError('file_limit','輸出 XML 超過10 MiB');
 void TASK_COLUMNS;void EXTRA_COLUMNS;return buffer;
}
