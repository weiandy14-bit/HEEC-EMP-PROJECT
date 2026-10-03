import type { GanttResponse, GanttFilters, GanttOptions, GanttTaskDetail, WorkloadResponse, WorkloadResource, WorkloadFilters, WeeklyBoardResponse, WeeklyBoardFilters } from './types';

export interface ApiResult<T> {
  status: number;
  body: T | null;
}

/**
 * 開發/測試身分替身標頭。
 * 僅在 Vite 開發模式(import.meta.env.DEV)且提供 VITE_DEV_* 時附加;
 * 正式建置不附加 —— 前端不得將其當成正式登入方案(正式經 OIDC/同源 cookie)。
 */
function devHeaders(): Record<string, string> {
  const env = import.meta.env as Record<string, string | undefined>;
  if (!env.DEV) return {};
  const org = env.VITE_DEV_ORG;
  const user = env.VITE_DEV_USER;
  const roles = env.VITE_DEV_ROLES ?? 'PM,Lead';
  if (!org || !user) return {};
  return { 'X-Org-Id': org, 'X-User-Id': user, 'X-Roles': roles };
}

export interface GanttQuery extends GanttFilters {
  task_cursor?: string;
  task_limit?: number;
  cursor?: string;
  limit?: number;
  status?: string;
}

export async function fetchGantt(q: GanttQuery): Promise<ApiResult<GanttResponse>> {
  const qs = new URLSearchParams();
  qs.set('zoom', q.zoom);
  qs.set('status', q.status ?? 'in_progress');
  if (q.project_id) qs.set('project_id', q.project_id);
  if (q.resource_id) qs.set('resource_id', q.resource_id);
  if (q.from) qs.set('from', `${q.from}T00:00:00+08:00`);
  if (q.to) qs.set('to', new Date(Date.parse(`${q.to}T00:00:00+08:00`) + 86400000).toISOString());
  if (q.pm_id) qs.set('pm_id', q.pm_id);
  if (q.discipline) qs.set('discipline', q.discipline);
  if (q.task_cursor) qs.set('task_cursor', q.task_cursor);
  if (q.task_limit) qs.set('task_limit', String(q.task_limit));
  if (q.cursor) qs.set('cursor', q.cursor);
  if (q.limit) qs.set('limit', String(q.limit));
  const res = await fetch(`/api/v1/dashboard/gantt?${qs.toString()}`, {
    headers: { ...devHeaders() },
  });
  let body: GanttResponse | null = null;
  try { body = (await res.json()) as GanttResponse; } catch { body = null; }
  return { status: res.status, body };
}

export async function fetchWorkload(q: WorkloadFilters & { weeks?: number;after_resource?:string }): Promise<ApiResult<WorkloadResponse>> {
  const qs = new URLSearchParams();
  if (q.from_week) qs.set('from_week', q.from_week);
  qs.set('weeks', String(q.weeks ?? 4));
  if(q.after_resource)qs.set('after_resource',q.after_resource);
  if (q.project_id) qs.set('project_id', q.project_id);
  if (q.team_id) qs.set('team_id', q.team_id);
  if (q.resource_id) qs.set('resource_id', q.resource_id);
  const res = await fetch(`/api/v1/dashboard/workload?${qs.toString()}`, { headers: { ...devHeaders() } });
  let body: WorkloadResponse | null = null;
  try { body = (await res.json()) as WorkloadResponse; } catch { body = null; }
  return { status: res.status, body };
}

export async function fetchWorkloadResource(resourceId: string, q: WorkloadFilters): Promise<ApiResult<WorkloadResource>> {
  const qs = new URLSearchParams();
  if (q.from_week) qs.set('from_week', q.from_week);
  if (q.project_id) qs.set('project_id', q.project_id);
  const res = await fetch(`/api/v1/dashboard/workload/resources/${resourceId}?${qs.toString()}`, { headers: { ...devHeaders() } });
  let body: WorkloadResource | null = null;
  try { body = (await res.json()) as WorkloadResource; } catch { body = null; }
  return { status: res.status, body };
}

export async function fetchWeekly(q: WeeklyBoardFilters): Promise<ApiResult<WeeklyBoardResponse>> {
  const qs = new URLSearchParams();
  qs.set('week', q.week);
  if (q.type) qs.set('type', q.type);
  if (q.assignee) qs.set('assignee', q.assignee);
  if(q.project_id)qs.set('project_id',q.project_id);
  if(q.offset)qs.set('offset',String(q.offset));
  if(q.limit)qs.set('limit',String(q.limit));
  const res = await fetch(`/api/v1/dashboard/weekly?${qs.toString()}`, { headers: { ...devHeaders() } });
  let body: WeeklyBoardResponse | null = null;
  try { body = (await res.json()) as WeeklyBoardResponse; } catch { body = null; }
  return { status: res.status, body };
}

/** Download server-scoped data, with export audit and spreadsheet-safe CSV. */
export async function downloadWorkload(q: WorkloadFilters): Promise<void> {
  const qs = new URLSearchParams({ weeks: '4' });
  for (const [key, value] of Object.entries(q)) if (value) qs.set(key, value);
  const res = await fetch(`/api/v1/dashboard/workload/export?${qs}`, { headers: devHeaders() });
  if (!res.ok) throw new Error(`匯出失敗 HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url; link.download = 'workload.csv';
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchGanttOptions(): Promise<ApiResult<GanttOptions>> {
  const res = await fetch('/api/v1/dashboard/gantt/options', { headers: devHeaders() });
  return { status: res.status, body: res.ok ? await res.json() as GanttOptions : null };
}
export async function fetchGanttTask(projectId: string, taskId: string): Promise<ApiResult<GanttTaskDetail>> {
  const res = await fetch(`/api/v1/projects/${projectId}/dashboard/gantt/tasks/${taskId}`, { headers: devHeaders() });
  return { status: res.status, body: res.ok ? await res.json() as GanttTaskDetail : null };
}

export async function fetchWeeklyOptions(){
 const r=await fetch('/api/v1/dashboard/weekly/options',{headers:devHeaders()});
 return {status:r.status,body:r.ok?await r.json() as import('./types').WeeklyOptions:null};
}
export async function fetchWorkloadOptions(){
 const r=await fetch('/api/v1/dashboard/workload/options',{headers:devHeaders()});
 return {status:r.status,body:r.ok?await r.json() as import('./types').WorkloadOptions:null};
}
export async function fetchWeeklySource(item:import('./types').WeeklyItem){
 const r=await fetch(`/api/v1/dashboard/weekly/sources/${item.project_id}/${item.source.kind}/${item.source.id}`,{headers:devHeaders()});
 return {status:r.status,body:r.ok?await r.json() as import('./types').SourceDetail:null};
}
export async function applySourceAction(action:{path:string;status:string}){
 if(!/^\/projects\/[a-zA-Z0-9-]+\/(deliverables|meetings|reviews|weekly-items)\//.test(action.path))throw new Error('來源操作路徑無效');
 const r=await fetch('/api/v1'+action.path,{method:'PATCH',headers:{...devHeaders(),'Content-Type':'application/json'},body:JSON.stringify({status:action.status})});
 if(!r.ok){const body=await r.json().catch(()=>null);throw new Error(body?.message??`操作失敗 HTTP ${r.status}`);}
}

export async function fetchUnassigned(q:WorkloadFilters,offset:number){
 const params=new URLSearchParams({weeks:'4',unassigned_offset:String(offset)});
 for(const [key,value] of Object.entries(q))if(value)params.set(key,value);
 const r=await fetch('/api/v1/dashboard/workload/unassigned?'+params,{headers:devHeaders()});
 if(!r.ok)throw new Error(`未指派工作載入失敗 HTTP ${r.status}`);
 return await r.json() as {items:import('./types').WorkloadUnassigned[]};
}

export async function fetchSavedGanttView(){
 const r=await fetch('/api/v1/dashboard/gantt/view',{headers:devHeaders()});
 if(!r.ok)throw new Error(`檢視載入失敗 HTTP ${r.status}`);
 return await r.json() as {view:GanttFilters|null};
}
export async function saveGanttView(view:GanttFilters){
 const r=await fetch('/api/v1/dashboard/gantt/view',{method:'PUT',headers:{...devHeaders(),'Content-Type':'application/json'},body:JSON.stringify(view)});
 if(!r.ok)throw new Error(`儲存檢視失敗 HTTP ${r.status}`);
}
