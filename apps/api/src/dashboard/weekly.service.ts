import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { WeeklyBoardQueryDto } from './dto';
import { countWorkingDays } from '@heec/scheduler';
import { buildCalendar } from '../schedule/mapper';
import { isoWeekStart } from './week';
const DAY=86400000, OFFSET=480*60000;
const visibility=`($4::boolean OR p.created_by=$3 OR p.pm_user_id=$3 OR EXISTS (SELECT 1 FROM project_members m WHERE m.org_id=p.org_id AND m.project_id=p.id AND m.user_id=$3 AND m.archived_at IS NULL))`;
@Injectable()
export class WeeklyBoardService {
 constructor(private readonly db:DatabaseService) {}
 private bounds(week?:string) {
  const wall=new Date(Date.now()+OFFSET);
  const monday=Date.UTC(wall.getUTCFullYear(),wall.getUTCMonth(),wall.getUTCDate())-((wall.getUTCDay()+6)%7)*DAY-OFFSET;
  const start=week && /^\d/.test(week)?isoWeekStart(week):monday+(week==='prev'?-7:week==='next'?7:0)*DAY;
  return {start:new Date(start).toISOString(),end:new Date(start+7*DAY).toISOString()};
 }
 private async ids(ctx:UserContext,project?:string) {
  const rows=await this.db.query<{id:string}>(`SELECT p.id FROM projects p WHERE p.org_id=$1 AND p.archived_at IS NULL AND ($2::uuid IS NULL OR p.id=$2) AND ${visibility}`,[ctx.orgId,project??null,ctx.userId,ctx.roles.includes('Admin')]);
  return rows.map(r=>r.id);
 }
 async options(ctx:UserContext) {
  const ids=await this.ids(ctx);
  const projects=await this.db.query(`SELECT id,name,code FROM projects WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY name`,[ctx.orgId,ids]);
  const owners=await this.db.query(`SELECT DISTINCT u.id,u.display_name AS name FROM users u WHERE u.org_id=$1 AND u.archived_at IS NULL AND u.id IN (
   SELECT owner_id FROM weekly_items WHERE project_id=ANY($2::uuid[]) UNION SELECT organizer_id FROM meetings WHERE project_id=ANY($2::uuid[])
   UNION SELECT approver_id FROM deliverables WHERE project_id=ANY($2::uuid[]) UNION SELECT s.owner_id FROM project_statutory_review_steps s JOIN project_statutory_reviews r ON r.id=s.review_id WHERE r.project_id=ANY($2::uuid[])) ORDER BY name`,[ctx.orgId,ids]);
  return {projects,owners};
 }
 async board(ctx:UserContext,q:WeeklyBoardQueryDto) {
  const {start,end}=this.bounds(q.week), ids=await this.ids(ctx,q.project_id);
  const offset=q.offset??0, limit=q.limit??100;
  if(!ids.length)return {weekStart:start,weekEnd:end,items:[],next_offset:null,partial_errors:[]};
  const params=[ctx.orgId,ids,start,end,q.assignee??null,offset+limit+1];
  const common=(alias:string)=>`${alias}.org_id=$1 AND ${alias}.archived_at IS NULL`;
  const jobs=[
   {kind:'deliverable',query:`SELECT d.id,d.project_id,p.name AS project_name,d.name AS title,d.approver_id AS assignee_id,u.display_name AS assignee_name,d.due_at,d.status,'交圖' AS type,
    (d.due_at<$3 AND d.status NOT IN ('accepted','locked')) AS overdue FROM deliverables d JOIN projects p ON p.id=d.project_id LEFT JOIN users u ON u.id=d.approver_id
    WHERE ${common('d')} AND d.project_id=ANY($2::uuid[]) AND ($5::uuid IS NULL OR d.approver_id=$5) AND ((d.due_at>=$3 AND d.due_at<$4) OR (d.due_at<$3 AND d.status NOT IN ('accepted','locked')))`},
   {kind:'review_step',query:`SELECT s.id,r.project_id,p.name AS project_name,s.step_code AS title,s.owner_id AS assignee_id,u.display_name AS assignee_name,COALESCE(s.due_at,s.planned_at) AS due_at,s.status,
    CASE WHEN s.status='revision' THEN '補正' ELSE '送審' END AS type,(COALESCE(s.due_at,s.planned_at)<$3 AND s.status NOT IN ('passed','failed')) AS overdue
    FROM project_statutory_review_steps s JOIN project_statutory_reviews r ON r.id=s.review_id JOIN projects p ON p.id=r.project_id LEFT JOIN users u ON u.id=s.owner_id
    WHERE ${common('s')} AND r.archived_at IS NULL AND r.project_id=ANY($2::uuid[]) AND ($5::uuid IS NULL OR s.owner_id=$5)
    AND ((COALESCE(s.due_at,s.planned_at)>=$3 AND COALESCE(s.due_at,s.planned_at)<$4) OR (COALESCE(s.due_at,s.planned_at)<$3 AND s.status NOT IN ('passed','failed')))`},
   {kind:'meeting',query:`SELECT m.id,m.project_id,p.name AS project_name,m.topic AS title,m.organizer_id AS assignee_id,u.display_name AS assignee_name,m.starts_at AS due_at,m.status,'會議' AS type,
    (m.starts_at<$3 AND m.status='scheduled') AS overdue FROM meetings m JOIN projects p ON p.id=m.project_id LEFT JOIN users u ON u.id=m.organizer_id
    WHERE ${common('m')} AND m.project_id=ANY($2::uuid[]) AND ($5::uuid IS NULL OR m.organizer_id=$5) AND ((m.starts_at>=$3 AND m.starts_at<$4) OR (m.starts_at<$3 AND m.status='scheduled'))`},
   {kind:'weekly_item',query:`SELECT w.id,w.project_id,p.name AS project_name,w.title,w.owner_id AS assignee_id,u.display_name AS assignee_name,w.due_at,w.period_start,w.period_end,w.status,CASE w.type WHEN 'general' THEN '工作' WHEN 'milestone' THEN '里程碑' WHEN 'internal_review' THEN '內部審查' WHEN 'coordination' THEN '協調' ELSE w.type END AS type,
    (COALESCE(w.period_end,w.due_at)<$3 AND w.status<>'done') AS overdue FROM weekly_items w JOIN projects p ON p.id=w.project_id LEFT JOIN users u ON u.id=w.owner_id
    WHERE ${common('w')} AND w.project_id=ANY($2::uuid[]) AND ($5::uuid IS NULL OR w.owner_id=$5) AND w.meeting_id IS NULL AND w.review_step_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM deliverables d WHERE d.project_id=w.project_id AND w.source_key='deliverable:'||d.id::text AND d.archived_at IS NULL)
    AND ((COALESCE(w.period_start,w.due_at)<$4 AND COALESCE(w.period_end,w.due_at)>=$3) OR (COALESCE(w.period_end,w.due_at)<$3 AND w.status<>'done'))`},
   {kind:'task',query:`SELECT t.id,t.project_id,p.name AS project_name,t.name AS title,t.owner_user_id AS assignee_id,u.display_name AS assignee_name,t.planned_finish AS due_at,t.status,'里程碑' AS type,
     (t.planned_finish<$3 AND t.actual_finish IS NULL AND t.percent_complete<100) AS overdue FROM project_tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.owner_user_id
     WHERE ${common('t')} AND t.project_id=ANY($2::uuid[]) AND t.milestone=true AND ($5::uuid IS NULL OR t.owner_user_id=$5)
      AND ((t.planned_finish>=$3 AND t.planned_finish<$4) OR (t.planned_finish<$3 AND t.actual_finish IS NULL AND t.percent_complete<100))`},
  ];
  const results=await Promise.allSettled(jobs.map(j=>this.db.query<any>(`SELECT * FROM (${j.query}) src WHERE ($7::text IS NULL OR type=$7) ORDER BY overdue DESC,due_at NULLS LAST,id LIMIT $6`,[...params,q.type??null])));
  const items:any[]=[], partial_errors:{kind:string;message:string}[]=[];
  results.forEach((result,i)=>{
   if(result.status==='rejected'){console.error('dashboard.weekly.source_failed',{kind:jobs[i].kind,error:result.reason});partial_errors.push({kind:jobs[i].kind,message:'來源暫時無法載入，請重試'});}
   else for(const r of result.value)items.push({...r,source:{kind:jobs[i].kind,id:r.id}});
  });
  if(partial_errors.length===jobs.length)throw new DomainError('infrastructure','weekly_unavailable','週工作來源暫時無法載入');
  items.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||String(a.due_at??'~').localeCompare(String(b.due_at??'~'))||a.id.localeCompare(b.id));
  const project_summary=await this.summary(ctx,ids);
  return {project_summary,weekStart:start,weekEnd:end,items:items.slice(offset,offset+limit),next_offset:items.length>offset+limit?offset+limit:null,partial_errors};
 }
 private async summary(ctx:UserContext,ids:string[]){
  const [projects,working,exceptions]=await Promise.all([
   this.db.query<any>(`SELECT p.id,p.name,p.health,p.percent_complete,p.permit_filing_date,p.default_calendar_id,c.timezone FROM projects p LEFT JOIN calendars c ON c.id=p.default_calendar_id WHERE p.org_id=$1 AND p.id=ANY($2::uuid[])`,[ctx.orgId,ids]),
   this.db.query<any>(`SELECT w.* FROM calendar_working_days w JOIN calendars c ON c.id=w.calendar_id WHERE c.org_id=$1 AND w.archived_at IS NULL`,[ctx.orgId]),
   this.db.query<any>(`SELECT e.* FROM calendar_exceptions e JOIN calendars c ON c.id=e.calendar_id WHERE c.org_id=$1 AND e.archived_at IS NULL`,[ctx.orgId])]);
  return projects.map(p=>{let remaining_workdays:number|null=null;
   if(p.permit_filing_date&&p.default_calendar_id&&p.timezone){const cal=buildCalendar({calendar:{id:p.default_calendar_id,timezone:p.timezone},workingDays:working.filter(w=>w.calendar_id===p.default_calendar_id),exceptions:exceptions.filter(e=>e.calendar_id===p.default_calendar_id)});
    const now=Math.floor(Date.now()/60000),finish=Math.floor(Date.parse(p.permit_filing_date+'T23:59:59+08:00')/60000);remaining_workdays=finish>=now?countWorkingDays(now,finish,cal):-countWorkingDays(finish,now,cal);}
   return {id:p.id,name:p.name,health:p.health,percent_complete:Number(p.percent_complete),permit_filing_date:p.permit_filing_date,remaining_workdays};
  });
 }
 async source(ctx:UserContext,projectId:string,kind:string,id:string) {
  if(!(await this.ids(ctx,projectId)).length)throw DomainError.notFound('來源');
  const queries:Record<string,string>={
   deliverable:`SELECT id,project_id,name AS title,status,revision,due_at,submitted_at,accepted_at,locked_at,approver_id AS owner_id FROM deliverables WHERE org_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL`,
   meeting:`SELECT id,project_id,topic AS title,status,starts_at,ends_at,minutes_attachment_id,organizer_id AS owner_id FROM meetings WHERE org_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL`,
   review_step:`SELECT s.id,r.project_id,s.step_code AS title,s.status,s.cycle_no,s.review_id,s.planned_at,s.actual_at,s.due_at,s.notes,s.owner_id,r.authority FROM project_statutory_review_steps s JOIN project_statutory_reviews r ON r.id=s.review_id WHERE s.org_id=$1 AND r.project_id=$2 AND s.id=$3 AND s.archived_at IS NULL AND r.archived_at IS NULL`,
   task:`SELECT id,project_id,name AS title,status,planned_start,planned_finish,actual_start,actual_finish,percent_complete FROM project_tasks WHERE org_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL`,
   weekly_item:`SELECT id,project_id,title,status,due_at,period_start,period_end,completed_at,source_key,owner_id FROM weekly_items WHERE org_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL`,
  };
  if(!queries[kind])throw DomainError.notFound('來源');
  const row=await this.db.queryOne<any>(queries[kind],[ctx.orgId,projectId,id]);
  if(!row)throw DomainError.notFound('來源');
  const manager=ctx.roles.some(r=>['Admin','PM','Lead'].includes(r));
  const canWrite=manager||(kind==='weekly_item' && ctx.roles.includes('Engineer') && row.owner_id===ctx.userId);
  const actions:{label:string;path:string;status:string}[]=[];
  if(canWrite){
   const root=`/projects/${projectId}`;
   if(kind==='deliverable' && !['accepted','locked'].includes(row.status))actions.push({label:row.status==='submitted'?'確認驗收完成':'確認已交圖',path:`${root}/deliverables/${id}`,status:row.status==='submitted'?'accepted':'submitted'});
   if(kind==='meeting' && row.status==='scheduled')actions.push({label:'確認會議已舉行',path:`${root}/meetings/${id}`,status:'held'});
   if(kind==='review_step' && !['passed','failed','revision'].includes(row.status))actions.push({label:'確認此步驟完成',path:`${root}/reviews/${row.review_id}/steps/${id}`,status:'passed'});
   if(kind==='weekly_item' && row.status!=='done')actions.push({label:'確認工作完成',path:`${root}/weekly-items/${id}`,status:'done'});
  }
  return {source:row,kind,actions};
 }
}
