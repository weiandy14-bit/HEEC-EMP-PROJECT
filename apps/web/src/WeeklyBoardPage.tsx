import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWeekly } from './api';
import type { WeeklyBoardResponse, WeeklyItem, WeeklyType } from './types';
import { LoadingState, EmptyState, ErrorState, NoPermissionState } from './components/States';

const TZ_MIN = 480, DAY = 86_400_000;
const DAYS = ['週一', '週二', '週三', '週四', '週五'];
const TYPES: WeeklyType[] = ['交圖', '送審', '補正', '會議'];

/** due_at → 週內天索引(0=Mon..4=Fri)，以 Asia/Taipei 計；逾期另置頂。 */
function dayIndex(due: string | null, weekStartMs: number): number {
  if (!due) return 0;
  const diff = Date.parse(due) - weekStartMs;
  return Math.min(4, Math.max(0, Math.floor(diff / DAY)));
}

export function WeeklyBoardPage() {
  const [week, setWeek] = useState<'prev' | 'this' | 'next'>('this');
  const [type, setType] = useState<WeeklyType | ''>('');
  const [data, setData] = useState<WeeklyBoardResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setPhase('loading');
    try {
      const r = await fetchWeekly({ week, type: type || undefined });
      if (my !== reqId.current) return;
      if (r.status === 403) { setPhase('forbidden'); return; }
      if (r.status >= 400 || !r.body) { setPhase('error'); setErrMsg(`HTTP ${r.status}`); return; }
      setData(r.body);
      setPhase(r.body.items.length === 0 ? 'empty' : 'ok');
    } catch (e) {
      if (my !== reqId.current) return;
      setPhase('error'); setErrMsg(e instanceof Error ? e.message : '網路錯誤');
    }
  }, [week, type]);

  useEffect(() => { void load(); }, [load]);

  const toolbar = (
    <header className="toolbar">
      <h1>本週重要事項</h1>
      <div className="week-group" role="group" aria-label="週切換">
        {(['prev', 'this', 'next'] as const).map((w) => (
          <button key={w} type="button" aria-pressed={week === w} data-testid={`week-${w}`} onClick={() => setWeek(w)}>
            {w === 'prev' ? '上週' : w === 'this' ? '本週' : '下週'}
          </button>
        ))}
      </div>
      <label className="filter">類型
        <select data-testid="filter-type" aria-label="類型篩選" value={type} onChange={(e) => setType(e.target.value as WeeklyType | '')}>
          <option value="">全部</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
    </header>
  );

  if (phase === 'loading') return <main className="app-16x9" data-testid="app-frame">{toolbar}<LoadingState /></main>;
  if (phase === 'forbidden') return <main className="app-16x9" data-testid="app-frame">{toolbar}<NoPermissionState /></main>;
  if (phase === 'error') return <main className="app-16x9" data-testid="app-frame">{toolbar}<ErrorState message={errMsg} onRetry={load} /></main>;
  if (phase === 'empty' || !data) return <main className="app-16x9" data-testid="app-frame">{toolbar}<EmptyState message="本週沒有重要事項。" /></main>;

  const weekStartMs = Date.parse(data.weekStart);
  const overdue = data.items.filter((i) => i.overdue);
  const byDay: WeeklyItem[][] = [[], [], [], [], []];
  for (const it of data.items) if (!it.overdue) byDay[dayIndex(it.due_at, weekStartMs)].push(it);

  return (
    <main className="app-16x9" data-testid="app-frame">
      {toolbar}
      {overdue.length > 0 && (
        <section className="overdue-band" data-testid="overdue-band">
          <h2>逾期未完成（置頂 · {overdue.length}）</h2>
          <div className="cards">{overdue.map((it) => <ItemCard key={it.id} item={it} />)}</div>
        </section>
      )}
      <div className="week-scroll" data-testid="week-scroll">
        <div className="week-grid">
          {DAYS.map((label, i) => (
            <section className="day-col" data-testid="day-col" data-day={i} key={label}>
              <h3>{label}</h3>
              <div className="cards">
                {byDay[i].map((it) => <ItemCard key={it.id} item={it} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function ItemCard({ item }: { item: WeeklyItem }) {
  return (
    <article className={`item-card${item.overdue ? ' overdue' : ''}`} data-testid="weekly-item"
      data-type={item.type} data-source-kind={item.source.kind} data-overdue={item.overdue}>
      <div className="item-head">
        <span className={`type-badge type-${item.source.kind}`} data-testid="type-badge">{item.type}</span>
        <span className="item-title">{item.title}</span>
      </div>
      <div className="item-meta">
        <span className="proj" data-testid="item-project">{item.project_name}</span>
        <span className="assignee" data-testid="item-assignee">{item.assignee_name ?? '未指定'}</span>
        <span className="status">{item.status}</span>
      </div>
    </article>
  );
}
