import { useEffect, useRef, useState } from 'react';
import { fetchGanttTask } from './api';
import type { GanttTaskDetail } from './types';
import { LoadingState, ErrorState, NoPermissionState } from './components/States';
const dateText = (value: string | null) => value ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '未填';
export function TaskDetailPanel({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<GanttTaskDetail | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    if (el?.showModal) el.showModal(); else el?.setAttribute('open', '');
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    let alive = true;
    setData(null); setError(''); setForbidden(false);
    void fetchGanttTask(projectId, taskId).then((r) => {
      if (!alive) return;
      if (r.status === 403 || r.status === 404) setForbidden(true);
      else if (r.status !== 200 || !r.body) setError(`工作明細載入失敗 HTTP ${r.status}`);
      else setData(r.body);
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : '工作明細載入失敗'); });
    return () => { alive = false; };
  }, [projectId, taskId, attempt]);
  return <dialog ref={dialog} className="task-detail" aria-labelledby="task-detail-title" onCancel={onClose}>
    <header><h2 id="task-detail-title">工作明細</h2><button type="button" onClick={onClose}>關閉工作明細</button></header>
    {forbidden ? <NoPermissionState /> : error ? <ErrorState message={error} onRetry={() => setAttempt((a) => a + 1)} /> : !data ? <LoadingState /> : <>
      <h3>{data.task.project_name} · {data.task.wbs_code} {data.task.name}</h3>
      <p>{data.task.description ?? '無說明'}</p>
      <dl><dt>專業／負責人</dt><dd>{data.task.discipline_name ?? '未指定'} ／ {data.task.owner_name ?? '未指定'}</dd>
        <dt>進度／工期</dt><dd>{data.task.percent_complete}% ／ {data.task.duration_minutes} 分鐘</dd>
        <dt>關鍵工作／總浮時／自由浮時</dt><dd>{data.task.critical ? '是' : '否'} ／ {data.task.total_float_minutes ?? '未計算'} ／ {data.task.free_float_minutes ?? '未計算'}</dd>
        {(['planned','baseline','actual'] as const).map((kind) => <div key={kind}><dt>{kind === 'planned' ? '計畫' : kind === 'baseline' ? 'Baseline' : '實際'}</dt><dd>{dateText(data.task[kind].start)} → {dateText(data.task[kind].finish)}</dd></div>)}
      </dl>
      <h3>資源指派</h3><ul>{data.assignments.map((a) => <li key={a.id}>{a.resource_name} · {a.planned_work_minutes} 分鐘 · 投入 {Number(a.assignment_units) * 100}% · {a.booking_type}</li>)}</ul>
      {data.assignments.length === 0 && <p>尚無指派</p>}
    </>}
  </dialog>;
}
