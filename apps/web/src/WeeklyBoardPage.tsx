import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWeekly,fetchWeeklyOptions } from './api';
import type { WeeklyBoardResponse, WeeklyItem, WeeklyType,WeeklyOptions } from './types';
import { LoadingState, EmptyState, ErrorState, NoPermissionState,PartialBanner } from './components/States';

import { SourceDetailPanel } from './SourceDetailPanel';
const DAY = 86_400_000;
const DAYS = ['週一', '週二', '週三', '週四', '週五','週末／跨週'];
const TYPES: WeeklyType[] = ['交圖', '送審', '補正', '會議','里程碑','內部審查','協調','工作'];

/** due_at → 週內天索引(0=Mon..4=Fri)，以 Asia/Taipei 計；逾期另置頂。 */
function dayIndex(due: string | null, weekStartMs: number): number {
  if (!due) return 0;
  const diff = Date.parse(due) - weekStartMs;
  return Math.min(5, Math.max(0, Math.floor(diff / DAY)));
}

export function WeeklyBoardPage() {
  const [week, setWeek] = useState<string>('this');
  const [type, setType] = useState<WeeklyType | ''>('');
  const [project,setProject]=useState(''),[assignee,setAssignee]=useState('');
  const [options,setOptions]=useState<WeeklyOptions>({projects:[],owners:[]});
  const [optionsError,setOptionsError]=useState('');
  const [selected,setSelected]=useState<WeeklyItem|null>(null);
  const focus=useRef<HTMLElement|null>(null);
  const [pageError,setPageError]=useState(''),[paging,setPaging]=useState(false);
  useEffect(()=>{let alive=true;void fetchWeeklyOptions().then(r=>{if(alive){if(r.body)setOptions(r.body);else setOptionsError('篩選選單載入失敗');}}).catch(()=>{if(alive)setOptionsError('篩選選單載入失敗');});return()=>{alive=false;};},[]);
  const [data, setData] = useState<WeeklyBoardResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async (offset?:number) => {
    const my = ++reqId.current;
    if(offset==null)setPhase('loading');else setPaging(true);setPageError('');
    try {
      const r = await fetchWeekly({ week, type: type || undefined,project_id:project||undefined,assignee:assignee||undefined,offset,limit:50 });
      if (my !== reqId.current) return;
      if (r.status === 403) { setPhase('forbidden'); return; }
      if (r.status >= 400 || !r.body) {if(offset!=null)setPageError(`載入失敗 HTTP ${r.status}`);else{setPhase('error');setErrMsg(`HTTP ${r.status}`);}return;}
      const body=r.body;setData(prev=>offset!=null&&prev?{...body,items:[...new Map([...prev.items,...body.items].map(i=>[i.source.kind+':'+i.id,i])).values()]}:body);
      setPhase(offset!=null?'ok':r.body.items.length === 0 && !r.body.partial_errors?.length ? 'empty' : 'ok');
    } catch (e) {
      if (my !== reqId.current) return;
      if(offset!=null)setPageError('載入失敗，請重試');else{setPhase('error');setErrMsg(e instanceof Error ? e.message : '網路錯誤');}
    }finally{if(my===reqId.current)setPaging(false);}
  }, [week, type,project,assignee]);

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
      <label>自訂週<input aria-label="自訂週" type="week" value={/^\d/.test(week)?week:''} onChange={e=>{if(e.target.value)setWeek(e.target.value);}}/></label>
      <label>案件<select aria-label="事項案件篩選" value={project} onChange={e=>setProject(e.target.value)}><option value="">全部</option>{options.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>責任人<select aria-label="責任人篩選" value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">全部</option>{options.owners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {optionsError&&<span role="status">{optionsError}</span>}
    </header>
  );

  if (phase === 'loading') return <main className="app-16x9" data-testid="app-frame">{toolbar}<LoadingState /></main>;
  if (phase === 'forbidden') return <main className="app-16x9" data-testid="app-frame">{toolbar}<NoPermissionState /></main>;
  if (phase === 'error') return <main className="app-16x9" data-testid="app-frame">{toolbar}<ErrorState message={errMsg} onRetry={()=>void load()} /></main>;
  if (phase === 'empty' || !data) return <main className="app-16x9" data-testid="app-frame">{toolbar}<EmptyState message="本週沒有重要事項。" /></main>;

  const weekStartMs = Date.parse(data.weekStart);
  const overdue = data.items.filter((i) => i.overdue);
  const byDay: WeeklyItem[][] = [[], [], [], [], [], []];
  for (const it of data.items) if (!it.overdue) byDay[dayIndex(it.due_at, weekStartMs)].push(it);

  return (
    <main className="app-16x9" data-testid="app-frame">
      {toolbar}
      {!!data.partial_errors?.length&&<PartialBanner failedCount={data.partial_errors.length}/>}
      {data.partial_errors?.map(e=><div key={e.kind} className="source-placeholder" data-testid="partial-placeholder">{e.kind}：{e.message}<button type="button" onClick={()=>void load()}>重試來源</button></div>)}
      {overdue.length > 0 && (
        <section className="overdue-band" data-testid="overdue-band">
          <h2>逾期未完成（置頂 · {overdue.length}）</h2>
          <div className="cards">{overdue.map((it) => <ItemCard key={it.source.kind+':'+it.id} item={it} onOpen={el=>{focus.current=el;setSelected(it);}} />)}</div>
        </section>
      )}
      <div className="week-scroll" data-testid="week-scroll">
        <div className="week-grid">
          {DAYS.map((label, i) => i===5 && !byDay[5].length ? null : (
            <section className="day-col" data-testid={i<5?"day-col":"weekend-col"} data-day={i} key={label}>
              <h3>{label}</h3>
              <div className="cards">
                {byDay[i].map((it) => <ItemCard key={it.source.kind+':'+it.id} item={it} onOpen={el=>{focus.current=el;setSelected(it);}} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
      {(data.next_offset!=null||data.items.length>=50)&&<div data-testid="large-volume">已載入 {data.items.length} 項；{data.next_offset!=null&&<button type="button" disabled={paging} onClick={()=>void load(data.next_offset!)}>載入更多事項</button>}</div>}
      {pageError&&<p role="alert">{pageError}</p>}
      {!!data.project_summary?.length&&<section className="project-summary" aria-label="各案進度與掛件緩衝">{data.project_summary.map(p=><span key={p.id}>{p.name}：{p.percent_complete}% · {p.health} · 距掛件 {p.remaining_workdays??'未設定日曆'} 工作日</span>)}</section>}
      {selected&&<SourceDetailPanel item={selected} onChanged={()=>void load()} onClose={()=>{setSelected(null);setTimeout(()=>focus.current?.isConnected&&focus.current.focus(),0);}}/>}
    </main>
  );
}

function ItemCard({ item,onOpen }: { item: WeeklyItem;onOpen:(el:HTMLElement)=>void }) {
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
      <button type="button" onClick={e=>onOpen(e.currentTarget)}>查看來源與完成確認：{item.title}</button>
    </article>
  );
}
