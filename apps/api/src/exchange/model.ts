export const TASK_COLUMNS = ['Task Name','WBS','Outline Level','Start','Finish','Duration','Predecessors','Resource Names','Work','% Complete','Baseline Start','Baseline Finish','Milestone','Constraint Type','Constraint Date','Notes','Unique ID','GUID'] as const;
export const EXTRA_COLUMNS=['ID','Actual Start','Actual Finish','Remaining Duration','System Code','Calendar Code','Summary','External Project','Task Type'] as const;
export const SCHEMA_VERSION=1;
export const LIMITS={bytes:10*1024*1024,expandedBytes:100*1024*1024,entries:10000,tasks:5000,edges:20000,assignments:20000,record:1024*1024};
export type SheetRow=Record<string,string>;
export interface Issue{row:number;field:string;code:string;message:string;severity:'error'|'warning'}
export interface ParseOptions{format:'csv'|'xlsx'|'csv-package';encoding?:'utf-8'|'big5';delimiter?:string;predecessorDelimiter?:string;predecessorMode?:'id'|'uid';resourceDelimiter?:string;timezone:string;dateFormat?:string;startTime?:string;finishTime?:string;hoursPerDay:number;calendarHours?:Record<string,number>;mapping?:Record<string,string>;maxNegativeLagMinutes?:number}
export interface ExchangeTask{supplied:string[];key:string;uid:string;guid:string;sourceId:string;row:number;name:string;wbs:string;level:number;parentKey:string|null;summary:boolean;milestone:boolean;start:string|null;finish:string|null;duration:number;work:number;percent:number;actualStart:string|null;actualFinish:string|null;remaining:number|null;baselineStart:string|null;baselineFinish:string|null;constraint:string;constraintDate:string|null;notes:string;resources:string[];calendar:string;discipline:string}
export interface ExchangeEdge{from:string;to:string;relation:'FS'|'SS'|'FF'|'SF';lag:number;row:number}
export interface ParsedExchange{schemaVersion:number;tasks:ExchangeTask[];dependencies:ExchangeEdge[];sheets:Record<string,SheetRow[]>;issues:Issue[]}
export class ExchangeParseError extends Error{constructor(public code:string,message:string){super(message);}}
