import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWorkload, fetchWorkloadResource, downloadWorkload,fetchWorkloadOptions,fetchUnassigned } from './api';
import type { WorkloadResponse, WorkloadFilters, WorkloadCell, WorkloadResource,WorkloadOptions } from './types';
import { LoadingState, EmptyState, ErrorState, NoPermissionState,PartialBanner } from './components/States';

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
  const [options,setOptions]=useState<WorkloadOptions>({projects:[],teams:[],resources:[]});
  const [optionsError,setOptionsError]=useState('');
  const [sort,setSort]=useState('name'),[page,setPage]=useState(0),[unassignedCount,setUnassignedCount]=useState(50);
  useEffect(()=>{let alive=true;void fetchWorkloadOptions().then(r=>{if(alive){if(r.body&&Array.isArray(r.body.projects)&&Array.isArray(r.body.teams)&&Array.isArray(r.body.resources))setOptions(r.body);else setOptionsError('篩選選單載入失敗');}}).catch(()=>{if(alive)setOptionsError('篩選選單載入失敗');});return()=>{alive=false;};},[]);
  const [filters, setFilters] = useState<WorkloadFilters>(loadSaved);
  const [data, setData] = useState<WorkloadResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [open, setOpen] = useState<string | null>(null); // 展開中的 cell key
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Record<string, WorkloadResource>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const reqId = useRef(0);

  const toggleCell = (resourceId: string, key: string, retry = false) => {
    if (open === key && !retry) { setOpen(null); return; }
    setOpen(key);
    if (!detail[resourceId]) {
      const version = reqId.current;
      setDetailErrors((prev) => ({ ...prev, [resourceId]: '' }));
      void fetchWorkloadResource(resourceId, { from_week: filters.from_week,project_id:filters.project_id }).then((r) => {
        if (version !== reqId.current) return;
        if (r.status === 200 && r.body) setDetail((prev) => ({ ...prev, [resourceId]: r.body! }));
        else setDetailErrors((prev) => ({ ...prev, [resourceId]: `每日明細載入失敗 HTTP ${r.status}` }));
      }).catch((e: unknown) => {
        if (version !== reqId.current) return;
        setDetailErrors((prev) => ({ ...prev, [resourceId]: e instanceof Error ? e.message : '每日明細載入失敗' }));
      });
    }
  };

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setPhase('loading');setPage(0);setUnassignedCount(50);
    setDetail({});
    setDetailErrors({});
    setOpen(null);
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

  const [paging,setPaging]=useState(false),[pagingError,setPagingError]=useState('');
  const moreResources=async()=>{
   if(!data?.next_resource||paging)return;const version=reqId.current;setPaging(true);setPagingError('');
   try{const r=await fetchWorkload({...filters,after_resource:data.next_resource});if(version!==reqId.current)return;if(!r.body||r.status!==200)throw new Error('工程師載入失敗');const body=r.body;
    setData(prev=>prev?{...prev,resources:[...prev.resources,...body.resources],next_resource:body.next_resource,teamSummary:mergeTeams(prev.teamSummary,body.teamSummary)}:body);
   }catch(e){if(version===reqId.current)setPagingError(e instanceof Error?e.message:'載入失敗');}finally{setPaging(false);}
  };
  const moreUnassigned=async()=>{if(!data||paging)return;const version=reqId.current;setPaging(true);setPagingError('');
   try{const page=await fetchUnassigned(filters,data.unassigned.length);if(version!==reqId.current)return;setData(prev=>prev?{...prev,unassigned:[...prev.unassigned,...page.items]}:prev);setUnassignedCount(n=>n+200);}catch(e){if(version===reqId.current)setPagingError(e instanceof Error?e.message:'載入失敗');}finally{setPaging(false);}
  };
  const exportData = async () => {
    setExporting(true); setExportError('');
    try { await downloadWorkload(filters); }
    catch (e) { setExportError(e instanceof Error ? e.message : '匯出失敗'); }
    finally { setExporting(false); }
  };

  const toolbar = (
    <header className="toolbar">
      <h1>工程師四週負荷</h1>
      <label className="filter">起始週<input data-testid="filter-from-week" aria-label="起始週 (YYYY-Www)"
        placeholder="2027-W10" value={filters.from_week ?? ''}
        onChange={(e) => update({ ...filters, from_week: e.target.value || undefined })} /></label>
      <label className="filter">團隊<select data-testid="filter-team" aria-label="團隊篩選" value={filters.team_id??''} onChange={e=>update({...filters,team_id:e.target.value||undefined})}><option value="">全部</option>{options.teams.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="filter">工程師<select data-testid="filter-resource" aria-label="工程師篩選" value={filters.resource_id??''} onChange={e=>update({...filters,resource_id:e.target.value||undefined})}><option value="">全部</option>{options.resources.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="filter">案件<select aria-label="負荷案件篩選" value={filters.project_id??''} onChange={e=>update({...filters,project_id:e.target.value||undefined})}><option value="">全部</option>{options.projects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>排序<select aria-label="負荷排序" value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="name">姓名</option><option value="load">負荷最高優先</option><option value="capacity">容量最多優先</option></select></label>
      {optionsError&&<span role="status">{optionsError}</span>}
      <button type="button" disabled={phase !== 'ok' || exporting} onClick={() => void exportData()}>
        {exporting ? '匯出中…' : '匯出負荷 CSV'}
      </button>
      {exportError && <span role="alert">{exportError}</span>}
      <button type="button" data-testid="reset-view" onClick={() => update({})}>重設檢視</button>
    </header>
  );

  if (phase === 'loading') return <main className="app-16x9" data-testid="app-frame">{toolbar}<LoadingState /></main>;
  if (phase === 'forbidden') return <main className="app-16x9" data-testid="app-frame">{toolbar}<NoPermissionState /></main>;
  if (phase === 'error') return <main className="app-16x9" data-testid="app-frame">{toolbar}<ErrorState message={errMsg} onRetry={load} /></main>;
  if (phase === 'empty' || !data) return <main className="app-16x9" data-testid="app-frame">{toolbar}<EmptyState message="目前沒有可顯示的工程師負荷。" /></main>;

  const weeks = data.weeks;
  const sorted=[...data.resources].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='load'?Math.max(...b.cells.map(c=>c.load_rate??(c.demand_minutes?Infinity:0)))-Math.max(...a.cells.map(c=>c.load_rate??(c.demand_minutes?Infinity:0))):b.cells.reduce((n,c)=>n+c.capacity_minutes,0)-a.cells.reduce((n,c)=>n+c.capacity_minutes,0));
  const visible=sorted.slice(page*50,(page+1)*50);
  return (
    <main className="app-16x9" data-testid="app-frame">
      {toolbar}
      {!!(data.partial_errors?.length||data.resources.some(r=>r.error))&&<PartialBanner failedCount={data.partial_errors?.length||data.resources.filter(r=>r.error).length}/>}
      <div className="workload-scroll" data-testid="workload-scroll">
        <table className="workload" data-testid="workload">
          <thead>
            <tr>
              <th className="name-col" scope="col">工程師</th>
              {weeks.map((w) => <th key={w} scope="col">{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.resource_id} data-testid="wl-row" data-resource-id={r.resource_id}>
                <th className="name-col" scope="row"><span className="resource-name">{r.name}</span><span className="muted"> ×{r.max_units}</span>{r.data_missing&&<span>資料缺漏</span>}</th>
                {r.error?<td colSpan={4} data-testid="partial-placeholder">日曆資料無法計算，請重試<button type="button" onClick={()=>void load()}>重試</button></td>:r.cells.map((c, i) => {
                  const band = loadBand(c);
                  const key = `${r.resource_id}:${i}`;
                  return (
                    <td key={i} className={`cell band-${band}`} data-testid="wl-cell"
                      data-band={band} data-week={c.week}>
                      <button type="button" className="cell-btn" data-testid={`cell-${key}`}
                        aria-expanded={open === key} aria-label={`${r.name} ${c.week} 負荷 ${pctText(c)} ${bandLabel(band)}`}
                        onClick={() => toggleCell(r.resource_id, key)}>
                        <span className="pct" data-testid="cell-pct">{pctText(c)}</span>
                        <span className="dc">{hours(c.demand_minutes)}/{hours(c.capacity_minutes)}</span>
                        <span className="band-label">{bandLabel(band)}</span>
                        <span className="flags">
                          {c.flags.map((f) => <span key={f} className={`flag flag-${f}`} data-testid={`flag-${f}`}>{flagLabel(f)}</span>)}
                        </span>
                      </button>
                      {open === key && (
                        <div className="sources" data-testid="cell-sources">
                          {!!r.unplaced_sources?.length&&<p role="status">無法分攤（指派缺日期）：{r.unplaced_sources.map(s=>`${s.project_name} / ${s.task_name} ${hours(s.planned_work_minutes)}`).join('；')}</p>}
                          {c.sources.length === 0 ? <p className="muted">無指派來源</p> : (
                            <ul>
                              {c.sources.map((s, j) => (
                                <li key={j} data-testid="source-row">
                                  案 {s.project_name??s.project_id.slice(0,8)} / WBS {s.wbs_code??'—'} {s.task_name??s.task_id.slice(0,8)} / 指派 {s.assignment_id?.slice(0,8)??'—'} · {hours(s.minutes)} · units {s.assignment_units}
                                  {s.booking_type === 'cover' && <span className="tag-cover" data-testid="tag-cover">代班</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(() => {
                            const days = detail[r.resource_id]?.cells[i]?.days;
                            if (detailErrors[r.resource_id]) return <div role="alert">
                              {detailErrors[r.resource_id]}
                              <button type="button" onClick={() => toggleCell(r.resource_id, key, true)}>重試每日明細</button>
                            </div>;
                            if (!days) return <p className="muted" data-testid="days-loading">每日明細載入中…</p>;
                            return (
                              <table className="days" data-testid="cell-days">
                                <thead><tr><th>日期</th><th>需求</th><th>容量</th><th>旗標</th></tr></thead>
                                <tbody>
                                  {days.map((d) => (
                                    <tr key={d.date} data-testid="day-row">
                                      <td>{d.date.slice(5)}</td><td>{hours(d.demand_minutes)}</td><td>{hours(d.capacity_minutes)}</td>
                                      <td>{d.flags.map((f) => <span key={f} className={`flag flag-${f}`}>{flagLabel(f)}</span>)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                          <div role="group" aria-label="每日指派與衝突來源">{detail[r.resource_id]?.cells[i]?.days?.map(d=><div key={d.date}>
                           {!!d.sources?.length&&<p>{d.date}：{d.sources.map(s=>`${s.project_name} / ${s.wbs_code} ${s.task_name} ${hours(s.minutes)}`).join('；')}</p>}
                           {d.conflicts?.map((conflict,j)=><p key={j} className="conflict">同時投入衝突：{formatTime(conflict.start)}–{formatTime(conflict.finish)}，投入 {Math.round(conflict.units*100)}% / 容量 {Math.round(conflict.max_units*100)}%</p>)}
                          </div>)}</div>
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

      {(data.resources.length>50||data.next_resource)&&<div data-testid="large-volume" className="list-pagination">
       工程師第 {page*50+1}–{Math.min((page+1)*50,sorted.length)} 位，共 {sorted.length} 位
       <button type="button" disabled={page===0} onClick={()=>{setPage(n=>n-1);setOpen(null);}}>上一頁工程師</button>
       <button type="button" disabled={(page+1)*50>=sorted.length} onClick={()=>{setPage(n=>n+1);setOpen(null);}}>下一頁工程師</button>
      </div>}
      {data.next_resource&&<button type="button" disabled={paging} onClick={()=>void moreResources()}>載入更多工程師</button>}
      {pagingError&&<p role="alert">{pagingError}；請重試載入。</p>}
      <section className="team-summary" aria-label="團隊容量與需求">
        <h2>團隊容量與需求</h2>
        {data.teamSummary.map((t) => <div key={t.team_id ?? 'none'}>
          <strong>{options.teams.find(o=>o.id===t.team_id)?.name??t.team_id??'未分組'}</strong>
          {t.weeks.map((c) => <span key={c.week}> · {c.week}: {hours(c.demand_minutes)} / {hours(c.capacity_minutes)}</span>)}
        </div>)}
      </section>
      <section className="unassigned" data-testid="unassigned">
        <h2>未指派工作（待分派 · {data.unassigned[0]?.total_count??data.unassigned.length}）</h2>
        {data.unassigned.length > 0 && (
          <ul>
            {data.unassigned.slice(0, unassignedCount).map((u) => (
              <li key={u.task_id} data-testid="unassigned-row">{u.wbs_code} {u.name} · {hours(u.duration_minutes)}</li>
            ))}
          </ul>
        )}
        {Number(data.unassigned[0]?.total_count??0)>data.unassigned.length&&<button type="button" disabled={paging} onClick={()=>void moreUnassigned()}>載入更多未指派工作</button>}
        {data.unassigned.length>unassignedCount&&<button type="button" onClick={()=>setUnassignedCount(n=>n+50)}>顯示更多未指派工作</button>}
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
    case 'data_missing': return '資料缺漏';
    default: return f;
  }
}

const formatTime=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(value));

function mergeTeams(a:WorkloadResponse['teamSummary'],b:WorkloadResponse['teamSummary']){
 const out=new Map(a.map(t=>[t.team_id,{...t,weeks:t.weeks.map(c=>({...c}))}]));
 for(const t of b){const found=out.get(t.team_id);if(!found){out.set(t.team_id,t);continue;}for(const c of t.weeks){const old=found.weeks.find(w=>w.week===c.week);if(old){old.demand_minutes+=c.demand_minutes;old.capacity_minutes+=c.capacity_minutes;old.load_rate=old.capacity_minutes?old.demand_minutes/old.capacity_minutes:null;}}}
 return [...out.values()];
}
