import { useEffect,useRef,useState } from 'react';
import { fetchWeeklySource,applySourceAction } from './api';
import type { WeeklyItem,SourceDetail } from './types';
import { LoadingState,ErrorState,NoPermissionState } from './components/States';
const labels:Record<string,string>={title:'標題',status:'狀態',revision:'版本',cycle_no:'審查輪次',due_at:'期限',period_start:'期間開始',period_end:'期間完成',starts_at:'會議開始',ends_at:'會議結束',actual_at:'實際日期',planned_at:'計畫日期',completed_at:'完成時間',source_key:'來源識別',authority:'送審機關',notes:'備註',submitted_at:'送出時間',accepted_at:'驗收時間',locked_at:'鎖定時間'};
export function SourceDetailPanel({item,onClose,onChanged}:{item:WeeklyItem;onClose:()=>void;onChanged:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),[data,setData]=useState<SourceDetail|null>(null),[error,setError]=useState(''),[forbidden,setForbidden]=useState(false),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{ref.current?.showModal?.();if(!ref.current?.open)ref.current?.setAttribute('open','');},[]);
 useEffect(()=>{let alive=true;setError('');setData(null);void fetchWeeklySource(item).then(r=>{if(!alive)return;if([403,404].includes(r.status))setForbidden(true);else if(r.status!==200||!r.body)setError('來源載入失敗，請重試');else setData(r.body);}).catch(e=>{if(alive)setError(String(e.message));});return()=>{alive=false;};},[item,attempt]);
 const close=()=>{ref.current?.close?.();onClose();};
 const act=async(action:SourceDetail['actions'][number])=>{setBusy(true);setError('');try{await applySourceAction(action);onChanged();close();}catch(e){setError(e instanceof Error?e.message:'操作失敗');}finally{setBusy(false);}};
 return <dialog ref={ref} className="task-detail" aria-labelledby="source-title" onCancel={e=>{e.preventDefault();close();}}>
  <header><h2 id="source-title">來源明細與完成確認</h2><button type="button" disabled={busy} onClick={close}>關閉來源明細</button></header>
  {forbidden?<NoPermissionState/>:!data?(error?<ErrorState message={error} onRetry={()=>setAttempt(n=>n+1)}/>:<LoadingState/>):<>
   <h3>{item.project_name} · {item.type}</h3><dl>{Object.entries(data.source).filter(([key])=>labels[key]).map(([key,value])=><div key={key}><dt>{labels[key]}</dt><dd>{value==null?'未填':key.endsWith('_at')||key.startsWith('period_')?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(String(value))):String(value)}</dd></div>)}</dl>
   {error&&<p role="alert">{error}</p>}{data.actions.length===0?<p>此來源為唯讀或已完成。</p>:data.actions.map(a=><button key={a.status} type="button" disabled={busy} onClick={()=>void act(a)}>{busy?'儲存中…':a.label}</button>)}
  </>}
 </dialog>;
}
