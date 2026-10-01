import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWorkload } from './api';
import type { WorkloadResponse, WorkloadFilters, WorkloadCell } from './types';
import { LoadingState, EmptyState, ErrorState, NoPermissionState } from './components/States';

const VIEW_KEY = 'workload.view.v1';

/** 負荷分級：正常 0–80% / 偏高 >80–100% / 超載 >100% / 零容量。 */
export function loadBand(cell: WorkloadCell): 'zero' | 'normal' | 'high' | 'over' {
  if (cell.capacity_minutes === 0 || cell.load_rate == null) return 'zero';
  if (cell.load_rate > 1.0) return 'over';
  if (cell.load_rate > 0.8) return 'high';
  return 'normal';
}
const pctText = (c: WorkloadCell) => (c.load_rate == null ? '—' : `${Math.round(c.load_rate * 100)}%`);
const hours = (m: number) => `${(m / 60).toFixed(1)}h`;
const bandLabel = (b: string) => (b === 'over' ? '超載' : b === 'high' ? '偏高' : b === 'zero' ? '零容量' : '正常');

function loadSaved(): WorkloadFilters {
  try { const r = localStorage.getItem(VIEW_KEY); if (r) return JSON.parse(r); } catch { /* ignore */ }
  return {};
}

export function WorkloadPage() {
  const [filters, setFilters] = useState<WorkloadFilters>(loadSaved);
  const [data, setData] = useState<WorkloadResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [open, setOpen] = useState<string | null>(null); // 展開中的 cell key
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setPhase('loading');
    try {
      const r = await fetchWorkload({ ...filters, weeks: 4 });
      if (my !== reqId.current) return;
      if (r.status === 403) { setPhase('forbidden'); return; }
      if (r.status >= 400 || !r.body) { setPhase('error'); setErrMsg(`HTTP ${r.status}`); return; }
      setData(r.body);
      setPhase(r.body.resources.length === 0 ? 'empty' : 'ok');
    } catch (e) {
      if (my !== reqId.current) return;
      setPhase('error'); setErrMsg(e instanceof Error ? e.message : '網路錯誤');
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const update = (f: WorkloadFilters) => {
    setFilters(f);
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(f)); } catch { /* ignore */ }
  };

  const toolbar = (
    <header className="toolbar">
      <h1>工程師四週負荷</h1>
      <label className="filter">起始週<input data-testid="filter-from-week" aria-label="起始週 (YYYY-Www)"
        placeholder="2027-W10" value={filters.from_week ?? ''}
        onChange={(e) => update({ ...filters, from_week: e.target.value || undefined })} /></label>
      <label className="filter">團隊<input data-testid="filter-team" aria-label="團隊篩選"
        value={filters.team_id ?? ''} onChange={(e) => update({ ...filters, team_id: e.target.value || undefined })} /></label>
      <label className="filter">工程師<input data-testid="filter-resource" aria-label="工程師篩選"
        value={filters.resource_id ?? ''} onChange={(e) => update({ ...filters, resource_id: e.target.value || undefined })} /></label>
      <button type="button" data-testid="reset-view" onClick={() => update({})}>重設檢視</button>
    </header>
  );

  if (phase === 'loading') return <main className="app-16x9" data-testid="app-frame">{toolbar}<LoadingState /></main>;
  if (phase === 'forbidden') return <main className="app-16x9" data-testid="app-frame">{toolbar}<NoPermissionState /></main>;
  if (phase === 'error') return <main className="app-16x9" data-testid="app-frame">{toolbar}<ErrorState message={errMsg} onRetry={load} /></main>;
  if (phase === 'empty' || !data) return <main className="app-16x9" data-testid="app-frame">{toolbar}<EmptyState message="目前沒有可顯示的工程師負荷。" /></main>;

  const weeks = data.weeks;
  return (
    <main className="app-16x9" data-testid="app-frame">
      {toolbar}
      <div className="workload-scroll" data-testid="workload-scroll">
        <table className="workload" data-testid="workload">
          <thead>
            <tr>
              <th className="name-col" scope="col">工程師</th>
              {weeks.map((w) => <th key={w} scope="col">{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.resources.map((r) => (
              <tr key={r.resource_id} data-testid="wl-row" data-resource-id={r.resource_id}>
                <th className="name-col" scope="row">{r.name}<span className="muted"> ×{r.max_units}</span></th>
                {r.cells.map((c, i) => {
                  const band = loadBand(c);
                  const key = `${r.resource_id}:${i}`;
                  return (
                    <td key={i} className={`cell band-${band}`} data-testid="wl-cell"
                      data-band={band} data-week={c.week}>
                      <button type="button" className="cell-btn" data-testid={`cell-${key}`}
                        aria-expanded={open === key} aria-label={`${r.name} ${c.week} 負荷 ${pctText(c)} ${bandLabel(band)}`}
                        onClick={() => setOpen(open === key ? null : key)}>
                        <span className="pct" data-testid="cell-pct">{pctText(c)}</span>
                        <span className="dc">{hours(c.demand_minutes)}/{hours(c.capacity_minutes)}</span>
                        <span className="band-label">{bandLabel(band)}</span>
                        <span className="flags">
                          {c.flags.map((f) => <span key={f} className={`flag flag-${f}`} data-testid={`flag-${f}`}>{flagLabel(f)}</span>)}
                        </span>
                      </button>
                      {open === key && (
                        <div className="sources" data-testid="cell-sources">
                          {c.sources.length === 0 ? <p className="muted">無指派來源</p> : (
                            <ul>
                              {c.sources.map((s, j) => (
                                <li key={j} data-testid="source-row">
                                  案 {s.project_id.slice(0, 8)} / 任務 {s.task_id.slice(0, 8)} · {hours(s.minutes)} · units {s.assignment_units}
                                  {s.booking_type === 'cover' && <span className="tag-cover" data-testid="tag-cover">代班</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="unassigned" data-testid="unassigned">
        <h2>未指派工作（待分派 · {data.unassigned.length}）</h2>
        {data.unassigned.length > 0 && (
          <ul>
            {data.unassigned.slice(0, 50).map((u) => (
              <li key={u.task_id} data-testid="unassigned-row">{u.wbs_code} {u.name} · {hours(u.duration_minutes)}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function flagLabel(f: string): string {
  switch (f) {
    case 'over_allocated': return '超載';
    case 'simultaneous_conflict': return '同時衝突';
    case 'zero_capacity': return '零容量';
    case 'on_leave': return '請假';
    default: return f;
  }
}
