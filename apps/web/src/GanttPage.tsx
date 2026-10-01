import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGantt } from './api';
import type { GanttProject, GanttTask, GanttFilters, Zoom } from './types';
import { LoadingState, EmptyState, ErrorState, NoPermissionState, PartialBanner } from './components/States';

const VIEW_KEY = 'gantt.view.v1';
const DEFAULT_FILTERS: GanttFilters = { zoom: 'week' };
const UNIT_PX: Record<Zoom, number> = { day: 40, week: 24, month: 8 };

function loadSavedView(): GanttFilters {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_FILTERS;
}

const d = (s: string | null): number | null => (s ? Date.parse(s) : null);

function useDomain(projects: GanttProject[]) {
  return useMemo(() => {
    const times: number[] = [Date.now()];
    for (const p of projects) {
      if (p.permit_filing_date) { const t = d(p.permit_filing_date); if (t) times.push(t); }
      for (const m of p.milestones) { const t = d(m.date); if (t) times.push(t); }
      for (const t of p.tasks) {
        for (const b of [t.planned, t.baseline, t.actual]) {
          const s = d(b.start), f = d(b.finish);
          if (s) times.push(s); if (f) times.push(f);
        }
      }
    }
    const min = Math.min(...times), max = Math.max(...times);
    const span = Math.max(max - min, 24 * 3600 * 1000);
    return { min, max: min + span, span };
  }, [projects]);
}

export function GanttPage() {
  const [filters, setFilters] = useState<GanttFilters>(loadSavedView);
  const [projects, setProjects] = useState<GanttProject[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  const load = useCallback(async (reset: boolean, cursor?: string) => {
    const myReq = ++reqId.current;
    if (reset) setPhase('loading');
    try {
      const r = await fetchGantt({ ...filters, cursor, limit: 50, status: 'in_progress' });
      if (myReq !== reqId.current) return; // 丟棄過期請求
      if (r.status === 403) { setPhase('forbidden'); return; }
      if (r.status >= 400 || !r.body) { setPhase('error'); setErrMsg(`HTTP ${r.status}`); return; }
      const incoming = r.body.projects ?? [];
      setProjects((prev) => (reset ? incoming : [...prev, ...incoming]));
      setNextCursor(r.body.next_cursor);
      setPhase((reset ? incoming : [...projects, ...incoming]).length === 0 ? 'empty' : 'ok');
    } catch (e) {
      if (myReq !== reqId.current) return;
      setPhase('error'); setErrMsg(e instanceof Error ? e.message : '網路錯誤');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => { void load(true); /* eslint-disable-next-line */ }, [filters]);

  const setZoom = (zoom: Zoom) => update({ ...filters, zoom });
  const update = (f: GanttFilters) => {
    setFilters(f);
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(f)); } catch { /* ignore */ }
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const domain = useDomain(projects);
  const pct = (t: number | null) => (t == null ? null : ((t - domain.min) / domain.span) * 100);
  const unitCount = Math.ceil(domain.span / (24 * 3600 * 1000));
  const timelineWidth = Math.max(640, unitCount * (UNIT_PX[filters.zoom] / (filters.zoom === 'day' ? 1 : filters.zoom === 'week' ? 7 : 30)));
  const todayLeft = pct(Date.now());
  const failed = projects.filter((p) => p.error);

  if (phase === 'loading') return <Shell filters={filters} onZoom={setZoom} onFilter={update}><LoadingState /></Shell>;
  if (phase === 'forbidden') return <Shell filters={filters} onZoom={setZoom} onFilter={update}><NoPermissionState /></Shell>;
  if (phase === 'error') return <Shell filters={filters} onZoom={setZoom} onFilter={update}><ErrorState message={errMsg} onRetry={() => load(true)} /></Shell>;
  if (phase === 'empty') return <Shell filters={filters} onZoom={setZoom} onFilter={update}><EmptyState message="目前沒有進行中的案件可顯示。" /></Shell>;

  return (
    <Shell filters={filters} onZoom={setZoom} onFilter={update}>
      {failed.length > 0 && <PartialBanner failedCount={failed.length} />}
      <div className="gantt" data-testid="gantt" data-zoom={filters.zoom}>
        <div className="gantt-scroll" data-testid="timeline-scroll">
          <div className="gantt-body" style={{ minWidth: timelineWidth }}>
            {todayLeft != null && (
              <div className="today-line" data-testid="today-line" style={{ left: `${todayLeft}%` }} aria-hidden="true" />
            )}
            {projects.map((p) => (
              <ProjectRows
                key={p.id} project={p} collapsed={collapsed} onToggle={toggle} pct={pct}
              />
            ))}
          </div>
        </div>
      </div>
      {nextCursor && (
        <div className="load-more" data-testid="large-volume">
          <button type="button" onClick={() => load(false, nextCursor)}>載入更多案件</button>
        </div>
      )}
    </Shell>
  );
}

function Shell(props: {
  filters: GanttFilters; onZoom: (z: Zoom) => void; onFilter: (f: GanttFilters) => void; children: React.ReactNode;
}) {
  const { filters, onZoom, onFilter, children } = props;
  return (
    <main className="app-16x9" data-testid="app-frame">
      <header className="toolbar">
        <h1>專案總控甘特</h1>
        <div className="zoom-group" role="group" aria-label="時間刻度">
          {(['day', 'week', 'month'] as Zoom[]).map((z) => (
            <button key={z} type="button" aria-pressed={filters.zoom === z}
              data-testid={`zoom-${z}`} onClick={() => onZoom(z)}>
              {z === 'day' ? '日' : z === 'week' ? '週' : '月'}
            </button>
          ))}
        </div>
        <label className="filter">PM<input data-testid="filter-pm" aria-label="PM 篩選"
          value={filters.pm_id ?? ''} onChange={(e) => onFilter({ ...filters, pm_id: e.target.value || undefined })} /></label>
        <label className="filter">專業<input data-testid="filter-discipline" aria-label="專業篩選"
          value={filters.discipline ?? ''} onChange={(e) => onFilter({ ...filters, discipline: e.target.value || undefined })} /></label>
        <button type="button" data-testid="reset-view" onClick={() => onFilter({ zoom: 'week' })}>重設檢視</button>
      </header>
      {children}
    </main>
  );
}

function ProjectRows({ project, collapsed, onToggle, pct }: {
  project: GanttProject; collapsed: Set<string>; onToggle: (id: string) => void; pct: (t: number | null) => number | null;
}) {
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, GanttTask[]>();
    for (const t of project.tasks) {
      const k = t.parent_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [project.tasks]);

  const rows: { task: GanttTask; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of childrenOf.get(parent) ?? []) {
      rows.push({ task: t, depth });
      if (!collapsed.has(t.id)) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <section className="project-group" data-testid="project" data-project-id={project.id} aria-label={`案件 ${project.name}`}>
      <div className="row project-header" data-testid="project-row">
        <div className="name-col" data-testid="name-col">
          <span className="proj-code">{project.code}</span> {project.name}
          <span className={`health health-${project.health}`}>{project.health}</span>
        </div>
        <div className="lane">
          {project.error && <span className="placeholder" data-testid="project-placeholder">資料暫缺</span>}
          {project.milestones.map((m) => {
            const left = pct(Date.parse(m.date));
            return left == null ? null : (
              <span key={`${m.kind}-${m.id}`} className={`milestone ms-${m.kind}`} data-testid="milestone"
                data-kind={m.kind} title={`${m.name}（${m.date}）`} style={{ left: `${left}%` }}>◆</span>
            );
          })}
        </div>
      </div>
      {rows.map(({ task, depth }) => {
        const hasChildren = (childrenOf.get(task.id) ?? []).length > 0;
        return (
          <div className={`row task-row${task.critical ? ' critical' : ''}`} key={task.id}
            data-testid="task-row" data-task-id={task.id} data-critical={task.critical}>
            <div className="name-col" style={{ paddingInlineStart: 12 + depth * 16 }}>
              {hasChildren ? (
                <button type="button" className="twisty" aria-expanded={!collapsed.has(task.id)}
                  data-testid={`toggle-${task.id}`} onClick={() => onToggle(task.id)}>
                  {collapsed.has(task.id) ? '▸' : '▾'}
                </button>
              ) : <span className="twisty-spacer" />}
              <span className="wbs">{task.wbs_code}</span> {task.name}
              <span className="task-status" data-testid="task-status">{statusLabel(task.status)}</span>
            </div>
            <div className="lane">
              <Bar kind="baseline" bar={task.baseline} pct={pct} />
              <Bar kind="planned" bar={task.planned} pct={pct} />
              <Bar kind="actual" bar={task.actual} pct={pct} />
            </div>
          </div>
        );
      })}
      {project.dependencies.map((dep) => (
        <div key={dep.id} className="dep-line" data-testid="dep-line"
          data-rel={dep.relation} data-pred={dep.predecessor_id} data-succ={dep.successor_id} aria-hidden="true" />
      ))}
    </section>
  );
}

function Bar({ kind, bar, pct }: { kind: string; bar: { start: string | null; finish: string | null }; pct: (t: number | null) => number | null }) {
  const l = pct(bar.start ? Date.parse(bar.start) : null);
  const r = pct(bar.finish ? Date.parse(bar.finish) : null);
  if (l == null || r == null) return null;
  const width = Math.max(0.5, r - l);
  return <div className={`bar bar-${kind}`} data-testid={`bar-${kind}`} data-kind={kind} style={{ left: `${l}%`, width: `${width}%` }} />;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'in_progress': return '進行中';
    case 'completed': return '已完成';
    case 'on_hold': return '暫停';
    default: return '未開始';
  }
}
