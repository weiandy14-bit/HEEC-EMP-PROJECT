import type {Calendar} from '@heec/scheduler';
import {buildCalendar} from '../schedule/mapper';
import {ExchangeParseError} from './model';

/** Resolve only requested calendars; unrelated invalid calendars do not poison an import. */
export function resolveCalendars(metas:any[],working:any[],exceptions:any[],requested:string[]):Calendar[]{
 const metadata=new Map(metas.map(m=>[m.id,m]));const resolved=new Map<string,Calendar>();
 const build=(id:string,path=new Set<string>()):Calendar=>{
  if(resolved.has(id))return resolved.get(id)!;
  if(path.has(id))throw new ExchangeParseError('calendar_cycle','工作日曆繼承循環');
  const meta=metadata.get(id);if(!meta)throw new ExchangeParseError('calendar_unknown','工作日曆不存在或已封存');
  const next=new Set(path);next.add(id);const parent=meta.parent_calendar_id?build(meta.parent_calendar_id,next):null;
  const own=buildCalendar({calendar:meta,workingDays:working.filter(w=>w.calendar_id===id),exceptions:exceptions.filter(e=>e.calendar_id===id)});
  const value={...own,weekly:own.weekly.length?own.weekly:parent?.weekly??[],exceptions:[...new Map([...(parent?.exceptions??[]),...(own.exceptions??[])].map(e=>[e.localDate,e])).values()]};
  resolved.set(id,value);return value;
 };
 for(const id of new Set(requested))build(id);return [...resolved.values()];
}
