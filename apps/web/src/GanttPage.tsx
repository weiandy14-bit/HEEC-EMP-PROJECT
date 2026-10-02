import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGantt, fetchGanttOptions } from './api';
import type { GanttProject, GanttTask, GanttFilters, GanttOptions, Zoom } from './types';
import { LoadingState, EmptyState, ErrorState, NoPermissionState, PartialBanner } from './components/States';

const VIEW_KEY = 'gantt.view.v1';
const DEFAULT_FILTERS: GanttFilters = { zoom: 'week' };
import { timelineDomain, timelineTicks } from './timeline';
import { TaskDetailPanel } from './TaskDetailPanel';
const UNIT_PX: Record<Zoom, number> = { day: 40, week: 24, month: 6 };

function loadSavedView(): GanttFilters {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_FILTERS;
}

const d = (s: string | null): number | null => (s ? Date.parse(s) : null);

function useDomain(projects: GanttProject[], from?: string, to?: string) {
  return useMemo(() => {
    const times: number[] = [];
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
    return timelineDomain(times, from, to);
  }, [projects, from, to]);
}

export function GanttPage() {
  const [filters, setFilters] = useState<GanttFilters>(loadSavedView);
  const [projects, setProjects] = useState<GanttProject[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const reqId = useRef(0);
  const [options, setOptions] = useState<GanttOptions>({ projects: [], pms: [], resources: [], disciplines: [] });
  const [optionsError, setOptionsError] = useState('');
  const [selected, setSelected] = useState<{ projectId: string; taskId: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchGanttOptions().then((r) => {
      if (!alive) return;
      if (r.status === 200 && r.body) setOptions(r.body);
      else setOptionsError('篩選選單暫時無法載入');
    }).catch(() => { if (alive) setOptionsError('篩選選單暫時無法載入'); });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (reset: boolean, cursor?: string) => {
    const myReq = ++reqId.current;
    if (reset) setPhase('loading');
    try {
      const r = await fetchGantt({ ...filters, cursor, limit: 50, status: filters.status ?? 'in_progress' });
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

  const domain = useDomain(projects, filters.from, filters.to);
  const ticks = timelineTicks(domain.min, domain.max, filters.zoom);
  const pct = (t: number | null) => (t == null ? null : ((t - domain.min) / domain.span) * 100);
  const unitCount = Math.ceil(domain.span / (24 * 3600 * 1000));
  const timelineWidth = Math.max(640, 300 + unitCount * UNIT_PX[filters.zoom]);
  const todayLeft = pct(Date.now());
  const failed = projects.filter((p) => p.error);

  if (phase === 'loading') return <Shell options={options} optionsError={optionsError} filters={filters} onZoom={setZoom} onFilter={update}><LoadingState /></Shell>;
  if (phase === 'forbidden') return <Shell options={options} optionsError={optionsError} filters={filters} onZoom={setZoom} onFilter={update}><NoPermissionState /></Shell>;
  if (phase === 'error') return <Shell options={options} optionsError={optionsError} filters={filters} onZoom={setZoom} onFilter={update}><ErrorState message={errMsg} onRetry={() => load(true)} /></Shell>;
  if (phase === 'empty') return <Shell options={options} optionsError={optionsError} filters={filters} onZoom={setZoom} onFilter={update}><EmptyState message="目前沒有進行中的案件可顯示。" /></Shell>;

  return (
    <Shell options={options} optionsError={optionsError} filters={filters} onZoom={setZoom} onFilter={update}>
      {failed.length > 0 && <PartialBanner failedCount={failed.length} />}
      <div className="gantt" data-testid="gantt" data-zoom={filters.zoom}>
        <div className="gantt-scroll" data-testid="timeline-scroll">
          <div className="gantt-body" style={{ minWidth: timelineWidth }}>
            <div className="row timeline-header" data-testid="timeline-header">
              <div className="name-col">案件／WBS · 計畫／Baseline／實際</div>
              <div className="lane">{ticks.map((tick) => <span key={tick.time} className="timeline-tick"
                style={{ left: `${pct(tick.time)}%` }}>{tick.label}</span>)}</div>
            </div>
            {todayLeft != null && todayLeft >= 0 && todayLeft <= 100 && (
              <div className="today-line" data-testid="today-line" style={{ left: `calc(var(--name-col) + (100% - var(--name-col)) * ${todayLeft / 100})` }} aria-hidden="true" />
            )}
            {projects.map((p) => (
              <ProjectRows
                key={p.id} project={p} collapsed={collapsed} onToggle={toggle} pct={pct} onTask={(taskId) => setSelected({ projectId: p.id, taskId })}
              />
            ))}
          </div>
        </div>
      </div>
      {selected && <TaskDetailPanel projectId={selected.projectId} taskId={selected.taskId} onClose={() => setSelected(null)} />}
      {nextCursor && (
        <div className="load-more" data-testid="large-volume">
          <button type="button" onClick={() => load(false, nextCursor)}>載入更多案件</button>
        </div>
      )}
    </Shell>
  );
}

function Shell(props: {
  options: GanttOptions; optionsError: string; filters: GanttFilters; onZoom: (z: Zoom) => void; onFilter: (f: GanttFilters) => void; children: React.ReactNode;
}) {
  const { filters, onZoom, onFilter, children, options, optionsError } = props;
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
        {([['project_id','案件',options.projects],['pm_id','PM',options.pms],['discipline','專業',options.disciplines],['resource_id','工程師',options.resources]] as const).map(([key,label,items]) => (
          <label className="filter" key={key}>{label}<select aria-label={`${label} 篩選`} data-testid={`filter-${key === 'pm_id' ? 'pm' : key === 'resource_id' ? 'resource' : key === 'project_id' ? 'project' : key}`}
            value={filters[key] ?? ''} onChange={(e) => onFilter({ ...filters, [key]: e.target.value || undefined })}>
            <option value="">全部</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        ))}
        <label className="filter">狀態<select aria-label="案件狀態" value={filters.status ?? 'in_progress'}
          onChange={(e) => onFilter({ ...filters, status: e.target.value })}>
          <option value="in_progress">進行中</option><option value="planning">規劃中</option>
          <option value="on_hold">暫停</option><option value="completed">已完成</option><option value="cancelled">取消</option>
        </select></label>
        <label className="filter">開始<input type="date" aria-label="開始日期" value={filters.from ?? ''}
          max={filters.to} onChange={(e) => onFilter({ ...filters, from: e.target.value || undefined })} /></label>
        <label className="filter">結束<input type="date" aria-label="結束日期" value={filters.to ?? ''}
          min={filters.from} onChange={(e) => onFilter({ ...filters, to: e.target.value || undefined })} /></label>
        {optionsError && <span role="status">{optionsError}</span>}
        <button type="button" data-testid="reset-view" onClick={() => onFilter({ zoom: 'week' })}>重設檢視</button>
      </header>
      {children}
    </main>
  );
}

function ProjectRows({ project, collapsed, onToggle, pct, onTask }: {
  onTask: (taskId: string) => void; project: GanttProject; collapsed: Set<string>; onToggle: (id: string) => void; pct: (t: number | null) => number | null;
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
                  aria-label={`${collapsed.has(task.id) ? '展開' : '收合'} ${task.name}`} data-testid={`toggle-${task.id}`} onClick={() => onToggle(task.id)}>
                  {collapsed.has(task.id) ? '▸' : '▾'}
                </button>
              ) : <span className="twisty-spacer" />}
              <span className="wbs">{task.wbs_code}</span> <button className="task-link" type="button" onClick={() => onTask(task.id)}>{task.name}</button>
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
      <svg className="dependency-overlay" viewBox={`0 0 1000 ${(rows.length + 1) * 30}`}
        preserveAspectRatio="none" role="img" aria-label={`${project.name} 工作相依關係`}>
        <defs><marker id={`arrow-${project.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
        </marker></defs>
        {project.dependencies.map((dep) => {
          const predIndex = rows.findIndex((r) => r.task.id === dep.predecessor_id);
          const succIndex = rows.findIndex((r) => r.task.id === dep.successor_id);
          if (predIndex < 0 || succIndex < 0) return null;
          const pred = rows[predIndex].task, succ = rows[succIndex].task;
          const start = pct(d(dep.relation[0] === 'F' ? pred.planned.finish : pred.planned.start));
          const finish = pct(d(dep.relation[1] === 'F' ? succ.planned.finish : succ.planned.start));
          if (start == null || finish == null) return null;
          const x1 = start * 10, x2 = finish * 10;
          const y1 = (predIndex + 1) * 30 + 15, y2 = (succIndex + 1) * 30 + 15;
          const elbow = Math.max(x1, x2) + 8;
          return <path key={dep.id} className="dep-line" data-testid="dep-line"
            data-rel={dep.relation} data-pred={dep.predecessor_id} data-succ={dep.successor_id}
            d={`M ${x1} ${y1} H ${elbow} V ${y2} H ${x2}`} markerEnd={`url(#arrow-${project.id})`}>
            <title>{`${pred.name} → ${succ.name}: ${dep.relation}, lag ${dep.lag_minutes} 分鐘`}</title>
          </path>;
        })}
      </svg>
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
