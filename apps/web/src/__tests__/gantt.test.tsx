import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { GanttProject, GanttResponse } from '../types';

// 以 mock 取代 API，餵入固定資料驗證 UI 行為（API 真實路徑由後端整合測試覆蓋）
const fetchGantt = vi.fn();
const fetchGanttTask = vi.fn();
const fetchGanttOptions = vi.fn();
vi.mock('../api', () => ({fetchSavedGanttView:()=>Promise.resolve({view:null}),saveGanttView:()=>Promise.resolve(), fetchGantt: (...a: unknown[]) => fetchGantt(...a),
  fetchGanttOptions: () => fetchGanttOptions(), fetchGanttTask: (...a: unknown[]) => fetchGanttTask(...a) }));

import { GanttPage } from '../GanttPage';

const bar = (start: string | null, finish: string | null) => ({ start, finish });
function task(over: Partial<GanttProject['tasks'][number]> = {}) {
  return {
    id: 't' + Math.random().toString(36).slice(2, 8),
    parent_id: null, wbs_code: '1', sort_key: '1', name: '任務', discipline_id: null,
    owner_user_id: null, milestone: false, summary: false, critical: false,
    status: 'not_started', percent_complete: 0,
    planned: bar('2027-01-12T01:00:00Z', '2027-01-15T10:00:00Z'),
    baseline: bar('2027-01-12T01:00:00Z', '2027-01-14T10:00:00Z'),
    actual: bar(null, null), ...over,
  };
}
function project(over: Partial<GanttProject> = {}): GanttProject {
  return {
    id: 'p' + Math.random().toString(36).slice(2, 8), code: 'C-' + Math.random().toString(36).slice(2, 6),
    name: '案件', status: 'active', health: 'normal', permit_filing_date: '2027-01-11',
    pm_user_id: null, tasks: [], dependencies: [], milestones: [], ...over,
  };
}
function resp(projects: GanttProject[], next_cursor: string | null = null): GanttResponse {
  return { zoom: 'week', from: null, to: null, next_cursor, projects };
}
const ok = (body: GanttResponse) => Promise.resolve({ status: 200, body });

beforeEach(() => { fetchGanttOptions.mockResolvedValue({ status: 200, body: { projects: [{id:'p1',name:'案一'}], pms:[], resources:[{id:'r1',name:'工程師一'}], disciplines:[] } }); fetchGanttTask.mockReset(); fetchGantt.mockReset(); localStorage.clear(); cleanup(); });

describe('P4-A 多案總控甘特 UI', () => {
  it('A1：多案同一時間軸、WBS 父子可展開/收合、三態 bar', async () => {
    const parent = task({ name: '設計', wbs_code: '1' });
    const child = task({ name: '基本設計', wbs_code: '1.1', parent_id: parent.id, critical: false });
    const pA = project({ name: '案A', tasks: [parent, child] });
    const pB = project({ name: '案B', tasks: [task()] });
    fetchGantt.mockReturnValue(ok(resp([pA, pB])));

    render(<GanttPage />);
    await waitFor(() => expect(screen.getAllByTestId('project')).toHaveLength(2));
    // 子任務可見 + 三態 bar
    expect(screen.getByText('基本設計')).toBeInTheDocument();
    const childRow = screen.getByText('基本設計').closest('[data-testid="task-row"]')!;
    expect(within(childRow as HTMLElement).getByTestId('bar-planned')).toBeInTheDocument();
    expect(within(childRow as HTMLElement).getByTestId('bar-baseline')).toBeInTheDocument();
    // 收合父任務 → 子任務隱藏；再展開 → 顯示
    fireEvent.click(screen.getByTestId(`toggle-${parent.id}`));
    expect(screen.queryByText('基本設計')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`toggle-${parent.id}`));
    expect(screen.getByText('基本設計')).toBeInTheDocument();
  });

  it('A2：日/週/月縮放；掛件唯一且與審查期限(review_due)區分', async () => {
    const p = project({
      permit_filing_date: '2027-01-11',
      tasks: [task()],
      milestones: [
        { kind: 'permit_filing', id: 'p1', name: '建照掛件', date: '2027-01-11' },
        { kind: 'review_due', id: 'r1', name: '消防審查', date: '2027-02-01' },
      ],
    });
    fetchGantt.mockReturnValue(ok(resp([p])));
    render(<GanttPage />);
    await screen.findByTestId('gantt');
    expect(screen.getByTestId('gantt')).toHaveAttribute('data-zoom', 'week');
    fireEvent.click(screen.getByTestId('zoom-month'));
    await waitFor(() => expect(screen.getByTestId('gantt')).toHaveAttribute('data-zoom', 'month'));
    const ms = screen.getAllByTestId('milestone');
    const filing = ms.filter((m) => m.getAttribute('data-kind') === 'permit_filing');
    const review = ms.filter((m) => m.getAttribute('data-kind') === 'review_due');
    expect(filing).toHaveLength(1);
    expect(review).toHaveLength(1);
    expect(filing[0].getAttribute('title')).toContain('2027-01-11');
    expect(review[0].getAttribute('title')).toContain('2027-02-01');
  });

  it('A3：關鍵路徑高亮 + baseline/planned 可對比', async () => {
    const t = task({ critical: true, planned: bar('2027-01-12T01:00:00Z', '2027-01-15T10:00:00Z'), baseline: bar('2027-01-12T01:00:00Z', '2027-01-14T10:00:00Z') });
    fetchGantt.mockReturnValue(ok(resp([project({ tasks: [t] })])));
    render(<GanttPage />);
    const row = await screen.findByTestId('task-row');
    expect(row).toHaveAttribute('data-critical', 'true');
    expect(within(row).getByTestId('bar-baseline')).toBeInTheDocument();
    expect(within(row).getByTestId('bar-planned')).toBeInTheDocument();
  });

  it('A6：Today 線、相依、PM/專業篩選、儲存檢視重開可還原', async () => {
    const a = task({ name: '前置', wbs_code: '1' });
    const b = task({ name: '後續', wbs_code: '2' });
    const p = project({ tasks: [a, b], dependencies: [{ id: 'd1', predecessor_id: a.id, successor_id: b.id, relation: 'FS', lag_minutes: 0 }] });
    fetchGantt.mockReturnValue(ok(resp([p])));
    const { unmount } = render(<GanttPage />);
    await screen.findByTestId('gantt');
    expect(screen.getByTestId('today-line')).toBeInTheDocument();
    expect(screen.getAllByTestId('dep-line')).toHaveLength(1);
    expect(screen.getByTestId('dep-line').tagName.toLowerCase()).toBe('path');
    expect(screen.getByTestId('dep-line').getAttribute('d')).toMatch(/^M /);
    expect(screen.getByTestId('dep-line')).toHaveAttribute('marker-end');
    expect(screen.getByTestId('filter-pm')).toBeInTheDocument();
    expect(screen.getByTestId('filter-discipline')).toBeInTheDocument();
    // 切換 zoom=day → 寫入 localStorage；重開還原
    fireEvent.click(screen.getByTestId('zoom-day'));
    await waitFor(() => expect(screen.getByTestId('zoom-day')).toHaveAttribute('aria-pressed', 'true'));
    unmount();
    render(<GanttPage />);
    await screen.findByTestId('gantt');
    expect(screen.getByTestId('zoom-day')).toHaveAttribute('aria-pressed', 'true');
  });

  it('A6 engineer/project/date filters persist and task opens detail', async () => {
    const t = task({ name: '詳細工作' });
    fetchGantt.mockReturnValue(ok(resp([project({ id:'p1', tasks:[t] })])));
    fetchGanttTask.mockResolvedValue({ status:200, body:{ task:{ ...t, project_name:'案一', duration_minutes:480, owner_name:'工程師一' }, assignments:[] } });
    render(<GanttPage />);
    await screen.findByTestId('gantt');
    await waitFor(() => expect(screen.getByRole('option', {name:'工程師一'})).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('filter-resource'), {target:{value:'r1'}});
    await waitFor(() => expect(fetchGantt).toHaveBeenLastCalledWith(expect.objectContaining({resource_id:'r1'})));
    fireEvent.change(screen.getByLabelText('開始日期'), {target:{value:'2027-01-01'}});
    await waitFor(() => expect(fetchGantt).toHaveBeenLastCalledWith(expect.objectContaining({from:'2027-01-01'})));
    await screen.findByTestId('gantt');
    fireEvent.click(screen.getByRole('button', {name:'詳細工作'}));
    expect(await screen.findByText('專業／負責人')).toBeInTheDocument();
    expect(fetchGanttTask).toHaveBeenCalledWith('p1',t.id);
    fireEvent.click(screen.getByRole('button', {name:'關閉工作明細'}));
    expect(screen.queryByText('專業／負責人')).not.toBeInTheDocument();
  });

  it('A6 explicit range clips bars and hides outside milestones', async () => {
    fetchGantt.mockReturnValue(ok(resp([project({ tasks:[task()],milestones:[{kind:'permit_filing',id:'p1',name:'掛件',date:'2027-01-11'}] })])));
    render(<GanttPage />);
    await screen.findByTestId('gantt');
    fireEvent.change(screen.getByLabelText('開始日期'),{target:{value:'2027-01-13'}});
    await screen.findByTestId('gantt');
    fireEvent.change(screen.getByLabelText('結束日期'),{target:{value:'2027-01-14'}});
    await screen.findByTestId('gantt');
    expect(screen.getByTestId('bar-planned')).toHaveStyle({left:'0%',width:'100%'});
    expect(screen.queryByTestId('milestone')).not.toBeInTheDocument();
  });

  it('U7：主框架 16:9、時間軸可水平捲動容器、名稱欄凍結', async () => {
    fetchGantt.mockReturnValue(ok(resp([project({ tasks: [task()] })])));
    render(<GanttPage />);
    await screen.findByTestId('gantt');
    expect(screen.getByTestId('app-frame')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-scroll')).toBeInTheDocument();
    expect(screen.getAllByTestId('name-col').length).toBeGreaterThan(0);
  });
});

describe('P4-U 六種 UI 狀態', () => {
  it('U1 載入：請求未決時顯示骨架', async () => {
    fetchGantt.mockReturnValue(new Promise(() => {})); // 永不解析
    render(<GanttPage />);
    expect(screen.getByTestId('state-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: '工程師一' })).toBeInTheDocument());
  });

  it('U2 空：無進行中案件 → 引導', async () => {
    fetchGantt.mockReturnValue(ok(resp([])));
    render(<GanttPage />);
    expect(await screen.findByTestId('state-empty')).toBeInTheDocument();
  });

  it('U3 錯誤：請求失敗 → 錯誤 + 重試', async () => {
    fetchGantt.mockRejectedValueOnce(new Error('boom'));
    render(<GanttPage />);
    expect(await screen.findByTestId('state-error')).toBeInTheDocument();
    // 重試改回成功
    fetchGantt.mockReturnValue(ok(resp([project({ tasks: [task()] })])));
    fireEvent.click(screen.getByText('重試'));
    expect(await screen.findByTestId('gantt')).toBeInTheDocument();
  });

  it('U4 無權限：403 → 無權限訊息', async () => {
    fetchGantt.mockReturnValue(Promise.resolve({ status: 403, body: null }));
    render(<GanttPage />);
    expect(await screen.findByTestId('state-no-permission')).toBeInTheDocument();
  });

  it('U5 部分資料：單案聚合失敗 → 橫幅 + 佔位，其餘正常', async () => {
    const good = project({ name: '正常案', tasks: [task()] });
    const bad = project({ name: '失敗案', error: true });
    fetchGantt.mockReturnValue(ok(resp([good, bad])));
    render(<GanttPage />);
    expect(await screen.findByTestId('state-partial')).toBeInTheDocument();
    expect(screen.getByTestId('project-placeholder')).toBeInTheDocument();
    expect(screen.getByText('正常案')).toBeInTheDocument();
  });

  it('U6 大資料量：有 next_cursor → 載入更多並附加', async () => {
    fetchGantt.mockReturnValueOnce(ok(resp([project({ name: '第一頁', tasks: [task()] })], 'CURSOR2')));
    render(<GanttPage />);
    await screen.findByTestId('gantt');
    expect(screen.getByTestId('large-volume')).toBeInTheDocument();
    fetchGantt.mockReturnValueOnce(ok(resp([project({ name: '第二頁', tasks: [task()] })], null)));
    fireEvent.click(screen.getByText('載入更多案件'));
    await waitFor(() => expect(screen.getByText('第二頁')).toBeInTheDocument());
    expect(screen.getByText('第一頁')).toBeInTheDocument();
  });
});

it('task paging preserves existing rows on failure, retries, and deduplicates ancestors', async()=>{
 const parent=task({id:'root',name:'既有工作'});
 const p=project({id:'p1',code:'P1',tasks:[parent],task_next_cursor:'next',task_count_remaining:1});
 fetchGantt.mockReturnValueOnce(ok(resp([p])));
 render(<GanttPage/>);
 await screen.findByText('既有工作');
 fetchGantt.mockRejectedValueOnce(new Error('分頁失敗'));
 fireEvent.click(screen.getByRole('button',{name:/載入 P1 更多工作/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('分頁失敗');
 expect(screen.getByText('既有工作')).toBeInTheDocument();
 fetchGantt.mockReturnValueOnce(ok(resp([{...p,tasks:[parent,task({id:'next',name:'新增工作',parent_id:'root'})],task_next_cursor:null}])));
 fireEvent.click(screen.getByRole('button',{name:/載入 P1 更多工作/}));
 await screen.findByText('新增工作');
 expect(screen.getAllByText('既有工作')).toHaveLength(1);
 expect(fetchGantt).toHaveBeenLastCalledWith(expect.objectContaining({project_id:'p1',task_cursor:'next'}));
});
