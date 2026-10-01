import type { GanttResponse, GanttFilters, WorkloadResponse, WorkloadFilters } from './types';

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
  cursor?: string;
  limit?: number;
  status?: string;
}

export async function fetchGantt(q: GanttQuery): Promise<ApiResult<GanttResponse>> {
  const qs = new URLSearchParams();
  qs.set('zoom', q.zoom);
  qs.set('status', q.status ?? 'in_progress');
  if (q.pm_id) qs.set('pm_id', q.pm_id);
  if (q.discipline) qs.set('discipline', q.discipline);
  if (q.cursor) qs.set('cursor', q.cursor);
  if (q.limit) qs.set('limit', String(q.limit));
  const res = await fetch(`/api/v1/dashboard/gantt?${qs.toString()}`, {
    headers: { ...devHeaders() },
  });
  let body: GanttResponse | null = null;
  try { body = (await res.json()) as GanttResponse; } catch { body = null; }
  return { status: res.status, body };
}

export async function fetchWorkload(q: WorkloadFilters & { weeks?: number }): Promise<ApiResult<WorkloadResponse>> {
  const qs = new URLSearchParams();
  if (q.from_week) qs.set('from_week', q.from_week);
  qs.set('weeks', String(q.weeks ?? 4));
  if (q.team_id) qs.set('team_id', q.team_id);
  if (q.resource_id) qs.set('resource_id', q.resource_id);
  const res = await fetch(`/api/v1/dashboard/workload?${qs.toString()}`, { headers: { ...devHeaders() } });
  let body: WorkloadResponse | null = null;
  try { body = (await res.json()) as WorkloadResponse; } catch { body = null; }
  return { status: res.status, body };
}
