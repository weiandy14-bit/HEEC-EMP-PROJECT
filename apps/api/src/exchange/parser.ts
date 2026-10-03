import {DateTime} from 'luxon';
import {ExchangeParseError,SCHEMA_VERSION,LIMITS,TASK_COLUMNS,EXTRA_COLUMNS,type ParseOptions,type SheetRow,type ParsedExchange,type ExchangeTask,type Issue,type ExchangeEdge} from './model';
import {readTables} from './formats';

export function durationMinutes(value:string,hoursPerDay:number,negative=false):number{
 if(!(hoursPerDay>0&&hoursPerDay<=24))throw new ExchangeParseError('calendar_invalid','日曆每日小時需大於0且<=24');
 const m=/^([+-]?\d+(?:\.\d+)?)\s*(min|m|h|d)$/i.exec(value.trim());if(!m)throw new ExchangeParseError('duration_invalid','工期/Work 須明確帶 min/h/d 單位');
 const n=Number(m[1])*(m[2].toLowerCase()==='d'?hoursPerDay*60:m[2].toLowerCase()==='h'?60:1);
 if(!Number.isSafeInteger(n)||(!negative&&n<0)||Math.abs(n)>20*366*24*60)throw new ExchangeParseError('duration_invalid','分鐘精度、負值或合理範圍不符');return n;
}
export function parseInstant(value:string,options:ParseOptions,boundary:'start'|'finish'='start'):string|null{
 if(!value.trim())return null;let raw=value.trim();const explicitOffset=/[T ][0-9:]+(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(raw);
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const time=boundary==='start'?options.startTime:options.finishTime;if(!time||!/^\d{2}:\d{2}$/.test(time))throw new ExchangeParseError('date_boundary_required','純日期須明確選開始/完成時段');raw+='T'+time;}
 const d=options.dateFormat&&!/^\d{4}-\d\d-\d\dT/.test(raw)?DateTime.fromFormat(raw,options.dateFormat,{zone:options.timezone,setZone:true,locale:'zh-TW'}):DateTime.fromISO(raw,{zone:options.timezone,setZone:true});
 if(!d.isValid||d.year<2000||d.year>2100||d.second||d.millisecond)throw new ExchangeParseError('date_invalid','日期須為有效2000–2100年整分鐘、ISO或指定格式');
 if(!explicitOffset){if(d.getPossibleOffsets().length>1)throw new ExchangeParseError('date_ambiguous','DST 重複時刻請附 UTC offset');const expected=options.dateFormat&&!/^\d{4}-\d\d-\d\dT/.test(raw)?d.toFormat(options.dateFormat):d.toFormat("yyyy-MM-dd'T'HH:mm");const normal=raw.replace(/:00(?:\.000)?$/,'');if(expected!==raw&&expected!==normal)throw new ExchangeParseError('date_gap','日期或 DST 時刻不可自動校正');}
 return d.toUTC().toISO();
}
export function predecessorTokens(value:string,options:ParseOptions):Array<{id:string;relation:ExchangeEdge['relation'];lag:number}>{
 if(!value.trim())return [];const sep=options.predecessorDelimiter??';';if(sep.length!==1||/[0-9A-Z+-]/i.test(sep))throw new ExchangeParseError('delimiter_invalid','前置分隔符格式錯誤');
 return value.split(sep).map(token=>{const m=/^\s*(\d+)(FS|SS|FF|SF)?([+-]\d+(?:\.\d+)?(?:min|m|h|d))?\s*$/i.exec(token);if(!m)throw new ExchangeParseError('predecessor_invalid','前置語法須為 12FS+2d，禁止尾端垃圾');const lag=m[3]?durationMinutes(m[3],options.hoursPerDay,true):0;if(lag<-(options.maxNegativeLagMinutes??14400))throw new ExchangeParseError('lag_out_of_bounds','負 lag 超過核定上限');return{id:m[1],relation:(m[2]?.toUpperCase()??'FS') as ExchangeEdge['relation'],lag};});
}
const bool=(s:string,defaultValue=false):boolean=>{if(!s.trim())return defaultValue;if(/^(1|true|yes)$/i.test(s))return true;if(/^(0|false|no)$/i.test(s))return false;throw new ExchangeParseError('boolean_invalid','布林值須為 true/false 或 1/0');};
const integer=(s:string,min:number,max:number):number=>{if(!/^\d+$/.test(s)||Number(s)<min||Number(s)>max)throw new ExchangeParseError('integer_invalid',`整數須位於 ${min}–${max}`);return Number(s);};
const issue=(issues:Issue[],row:number,field:string,e:unknown)=>{issues.push({row,field,code:e instanceof ExchangeParseError?e.code:'row_invalid',message:e instanceof Error?e.message:'資料無效',severity:'error'});};
export function normalizeTables(sheets:Record<string,SheetRow[]>,options:ParseOptions):ParsedExchange{
 const issues:Issue[]=[];const tasks:ExchangeTask[]=[];const dependencies:ExchangeEdge[]=[];const rows=sheets.Tasks??[];
 if(rows.length>LIMITS.tasks)throw new ExchangeParseError('row_limit','單案最多5,000個工作');
 const allowed=new Set<string>([...TASK_COLUMNS,...EXTRA_COLUMNS]);const mapping=options.mapping??{};if(Object.values(mapping).some(v=>!allowed.has(v))||new Set(Object.values(mapping)).size!==Object.values(mapping).length)throw new ExchangeParseError('mapping_invalid','映射目的欄不可未知或重複');
 const mapped=rows.map(raw=>{const r:SheetRow=Object.create(null);for(const [k,v]of Object.entries(raw)){const target=mapping[k]??k;if(!allowed.has(target))continue;if(Object.hasOwn(r,target))throw new ExchangeParseError('mapping_invalid','映射後表頭重複');r[target]=v;}return r;});
 if(!rows.length)issue(issues,0,'Tasks',new ExchangeParseError('tasks_empty','沒有可匯入工作'));
 const stack:ExchangeTask[]=[];const pending:Array<{task:ExchangeTask;value:string}>=[];
 mapped.forEach((r,i)=>{const row=i+2;const val=(name:string)=>r[name]??'';let field='Task Name';try{
  const name=val(field);if(!name.trim()||name.length>1000)throw new ExchangeParseError('name_invalid','工作名稱必填且<=1000字');
  field='Unique ID';const uid=val('Unique ID').trim();const guid=val('GUID').trim();if(!uid&&!guid)throw new ExchangeParseError('identity_missing','須有 Unique ID 或 GUID');if(uid&&!/^\d+$/.test(uid))throw new ExchangeParseError('identity_invalid','Unique ID須為數字');if(guid&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid))throw new ExchangeParseError('identity_invalid','GUID格式錯誤');
  field='Outline Level';const level=integer(val(field),1,5000);if(level>stack.length+1)throw new ExchangeParseError('outline_jump','Outline Level不可跨級');
  const key=guid?'guid:'+guid.toLowerCase():'uid:'+uid;const calendar=val('Calendar Code');const hours=calendar?options.calendarHours?.[calendar]:options.hoursPerDay;if(hours===undefined)throw new ExchangeParseError('calendar_unknown','請映射 Calendar Code');
  field='Duration';const duration=durationMinutes(val(field),hours);field='Work';const work=val(field)?durationMinutes(val(field),hours):0;
  field='% Complete';const percent=integer(val(field)||'0',0,100);field='Milestone';const milestone=bool(val(field),duration===0);if(milestone&&duration!==0)throw new ExchangeParseError('milestone_duration','里程碑工期必須為0');
  field='Summary';const summary=bool(val(field));if(summary&&milestone)throw new ExchangeParseError('summary_milestone','摘要不可同時是里程碑');
  field='Start';const start=parseInstant(val(field),options);field='Finish';const finish=parseInstant(val(field),options,'finish');if(!!start!==!!finish||start&&finish&&finish<start)throw new ExchangeParseError('date_order','計畫起訖須成對且完成>=開始');if(milestone&&start&&start!==finish)throw new ExchangeParseError('milestone_range','里程碑起訖需同一瞬間');
  field='Actual Start';const actualStart=parseInstant(val(field),options);field='Actual Finish';const actualFinish=parseInstant(val(field),options,'finish');if(!summary&&(percent===100)!==!!actualFinish)throw new ExchangeParseError('actual_inconsistent','100%需實際完成，未完成不可有實際完成');if(actualFinish&&actualStart&&actualFinish<actualStart)throw new ExchangeParseError('actual_order','實際完成不可早於開始');
  field='Baseline Start';const baselineStart=parseInstant(val(field),options);field='Baseline Finish';const baselineFinish=parseInstant(val(field),options,'finish');if(!!baselineStart!==!!baselineFinish||baselineStart&&baselineFinish&&baselineFinish<baselineStart)throw new ExchangeParseError('baseline_order','基準起訖須有效且成對');
  field='Constraint Type';const constraints=['ASAP','ALAP','MSO','MFO','SNET','SNLT','FNET','FNLT'];let constraint=val(field).toUpperCase()||'ASAP';if(/^\d$/.test(constraint))constraint=constraints[Number(constraint)]??'';if(!constraints.includes(constraint))throw new ExchangeParseError('constraint_invalid','不支援限制型別');field='Constraint Date';const constraintDate=parseInstant(val(field),options);if(!['ASAP','ALAP'].includes(constraint)&&!constraintDate)throw new ExchangeParseError('constraint_date_missing','限制需日期');
  field='External Project';if(val(field))throw new ExchangeParseError('cross_project','禁止跨案相依');field='ID';const sourceId=val(field).trim();if(sourceId&&!/^\d+$/.test(sourceId))throw new ExchangeParseError('identity_invalid','ID須為數字');
  const task:ExchangeTask={supplied:Object.keys(r),key,uid,guid,sourceId,row,name,wbs:val('WBS'),level,parentKey:level>1?stack[level-2].key:null,summary,milestone,start,finish,duration,work,percent,actualStart,actualFinish,remaining:val('Remaining Duration')?durationMinutes(val('Remaining Duration'),hours):null,baselineStart,baselineFinish,constraint,constraintDate,notes:val('Notes'),resources:val('Resource Names').split(options.resourceDelimiter??';').map(s=>s.trim()).filter(Boolean),calendar,discipline:val('System Code')};
  if(!task.wbs.trim())throw new ExchangeParseError('wbs_missing','WBS必填');tasks.push(task);pending.push({task,value:val('Predecessors')});stack.length=level-1;stack.push(task);
 }catch(e){issue(issues,row,field,e);}});
 const keys=new Set<string>(),wbs=new Set<string>(),uid=new Set<string>(),ids=new Map<string,string>();
 for(const t of tasks){if(keys.has(t.key)||wbs.has(t.wbs)||t.uid&&uid.has(t.uid))issue(issues,t.row,'Unique ID',new ExchangeParseError('identity_duplicate','ID/GUID/WBS重複'));keys.add(t.key);wbs.add(t.wbs);if(t.uid)uid.add(t.uid);const ref=options.predecessorMode==='uid'?t.uid:t.sourceId;if(ref){if(ids.has(ref))issue(issues,t.row,'ID',new ExchangeParseError('identity_duplicate','前置識別重複'));ids.set(ref,t.key);}}
 const parents=new Set(tasks.map(t=>t.parentKey).filter(Boolean));for(const t of tasks)if(parents.has(t.key)){if(!t.supplied.includes('Summary')){t.summary=true;if(!t.supplied.includes('Milestone'))t.milestone=false;}else if(!t.summary)issue(issues,t.row,'Summary',new ExchangeParseError('summary_required','父工作須為Summary'));}
 const edges=new Set<string>();for(const {task,value}of pending){try{for(const p of predecessorTokens(value,{...options,hoursPerDay:task.calendar?options.calendarHours![task.calendar]:options.hoursPerDay})){const from=ids.get(p.id);if(!from)throw new ExchangeParseError('predecessor_unknown','前置ID不存在；請確認 ID/Unique ID模式');if(from===task.key)throw new ExchangeParseError('dependency_self','不可自相依');if(tasks.find(t=>t.key===from)?.summary||task.summary)throw new ExchangeParseError('dependency_summary','相依只能連葉工作');const edge=from+'>'+task.key;if(edges.has(edge))throw new ExchangeParseError('dependency_duplicate','重複前置關係');edges.add(edge);dependencies.push({from,to:task.key,relation:p.relation,lag:p.lag,row:task.row});}}catch(e){issue(issues,task.row,'Predecessors',e);}}
 if(dependencies.length>LIMITS.edges)throw new ExchangeParseError('edge_limit','相依數超限');
 const degree=new Map(tasks.map(t=>[t.key,0]));const outgoing=new Map<string,string[]>();for(const e of dependencies){degree.set(e.to,degree.get(e.to)!+1);outgoing.set(e.from,[...(outgoing.get(e.from)??[]),e.to]);}const queue=[...degree].filter(([,n])=>n===0).map(([k])=>k);let count=0;for(let q=0;q<queue.length;q++){count++;for(const to of outgoing.get(queue[q])??[]){degree.set(to,degree.get(to)!-1);if(degree.get(to)===0)queue.push(to);}}if(count!==tasks.length)issue(issues,0,'Predecessors',new ExchangeParseError('dependency_cycle','循環相依，請移除衝突邊'));
 return{schemaVersion:SCHEMA_VERSION,tasks,dependencies,sheets,issues};
}
export async function parseExchange(bytes:Buffer,options:ParseOptions):Promise<ParsedExchange>{if(!DateTime.now().setZone(options.timezone).isValid)throw new ExchangeParseError('timezone_invalid','IANA時區無效');return normalizeTables(await readTables(bytes,options),options);}
