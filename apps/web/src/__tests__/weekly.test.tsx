import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { WeeklyBoardResponse, WeeklyItem } from '../types';

const fetchWeekly = vi.fn();
vi.mock('../api', () => ({ fetchWeeklyOptions:()=>Promise.resolve({status:200,body:{projects:[],owners:[]}}), fetchWeeklySource:()=>Promise.resolve({status:200,body:{kind:'meeting',source:{title:'來源',status:'scheduled'},actions:[]}}), applySourceAction:()=>Promise.resolve(), fetchWeekly: (...a: unknown[]) => fetchWeekly(...a) }));

import { WeeklyBoardPage } from '../WeeklyBoardPage';

const WEEK_START = '2027-03-15T16:00:00.000Z'; // 週一 00:00 台北（示意）
function item(over: Partial<WeeklyItem> = {}): WeeklyItem {
  return {
    id: 'i' + Math.random().toString(36).slice(2, 8), type: '交圖', title: '消防圖',
    project_id: 'p1', project_name: '案A', assignee_id: 'u1', assignee_name: '王工',
    source: { kind: 'deliverable', id: 'd1' }, due_at: '2027-03-17T02:00:00.000Z', status: 'draft', overdue: false, ...over,
  };
}
function resp(items: WeeklyItem[]): WeeklyBoardResponse {
  return { weekStart: WEEK_START, weekEnd: '2027-03-22T16:00:00.000Z', items };
}
const ok = (body: WeeklyBoardResponse) => Promise.resolve({ status: 200, body });

beforeEach(() => { fetchWeekly.mockReset(); cleanup(); });

describe('P4-B 本週重要事項 UI', () => {
  it('B1：跨型別卡片含型別徽章、案件、責任人、來源', async () => {
    fetchWeekly.mockReturnValue(ok(resp([
      item({ type: '交圖', source: { kind: 'deliverable', id: 'd1' } }),
      item({ type: '送審', source: { kind: 'review_step', id: 's1' }, title: 'SUBMIT' }),
      item({ type: '會議', source: { kind: 'meeting', id: 'm1' }, title: '協調會', assignee_name: '李工' }),
    ])));
    render(<WeeklyBoardPage />);
    await waitFor(() => expect(screen.getAllByTestId('weekly-item')).toHaveLength(3));
    const badges = screen.getAllByTestId('type-badge').map((b) => b.textContent);
    expect(badges).toEqual(expect.arrayContaining(['交圖', '送審', '會議']));
    const first = screen.getAllByTestId('weekly-item')[0];
    expect(within(first).getByTestId('item-project')).toBeInTheDocument();
    expect(within(first).getByTestId('item-assignee')).toBeInTheDocument();
  });

  it('B2：週切換按鈕觸發重新查詢（prev/this/next）', async () => {
    fetchWeekly.mockReturnValue(ok(resp([item()])));
    render(<WeeklyBoardPage />);
    await screen.findByTestId('week-scroll');
    expect(fetchWeekly).toHaveBeenLastCalledWith(expect.objectContaining({ week: 'this' }));
    fireEvent.click(screen.getByTestId('week-next'));
    await waitFor(() => expect(fetchWeekly).toHaveBeenLastCalledWith(expect.objectContaining({ week: 'next' })));
    fireEvent.click(screen.getByTestId('week-prev'));
    await waitFor(() => expect(fetchWeekly).toHaveBeenLastCalledWith(expect.objectContaining({ week: 'prev' })));
  });

  it('B3：逾期未完成置頂於逾期帶', async () => {
    fetchWeekly.mockReturnValue(ok(resp([
      item({ overdue: true, title: '逾期送審', type: '送審', source: { kind: 'review_step', id: 's9' } }),
      item({ overdue: false, title: '本週交圖' }),
    ])));
    render(<WeeklyBoardPage />);
    const band = await screen.findByTestId('overdue-band');
    expect(within(band).getByText('逾期送審')).toBeInTheDocument();
    // 非逾期不在逾期帶
    expect(within(band).queryByText('本週交圖')).not.toBeInTheDocument();
  });

  it('B5：類型篩選改變查詢參數', async () => {
    fetchWeekly.mockReturnValue(ok(resp([item()])));
    render(<WeeklyBoardPage />);
    await screen.findByTestId('week-scroll');
    fireEvent.change(screen.getByTestId('filter-type'), { target: { value: '會議' } });
    await waitFor(() => expect(fetchWeekly).toHaveBeenLastCalledWith(expect.objectContaining({ type: '會議' })));
  });

  it('週一至週五欄位呈現', async () => {
    fetchWeekly.mockReturnValue(ok(resp([item()])));
    render(<WeeklyBoardPage />);
    await screen.findByTestId('week-scroll');
    expect(screen.getAllByTestId('day-col')).toHaveLength(5);
  });

  it('狀態 U1/U2/U3/U4 與 16:9', async () => {
    fetchWeekly.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<WeeklyBoardPage />);
    expect(screen.getByTestId('state-loading')).toBeInTheDocument();
    expect(screen.getByTestId('app-frame')).toBeInTheDocument();
    unmount(); cleanup();
    fetchWeekly.mockReturnValue(ok(resp([])));
    render(<WeeklyBoardPage />);
    expect(await screen.findByTestId('state-empty')).toBeInTheDocument();
    cleanup();
    fetchWeekly.mockReturnValue(Promise.resolve({ status: 403, body: null }));
    render(<WeeklyBoardPage />);
    expect(await screen.findByTestId('state-no-permission')).toBeInTheDocument();
    cleanup();
    fetchWeekly.mockRejectedValueOnce(new Error('x'));
    render(<WeeklyBoardPage />);
    expect(await screen.findByTestId('state-error')).toBeInTheDocument();
    fetchWeekly.mockReturnValue(ok(resp([item()])));
    fireEvent.click(screen.getByText('重試'));
    expect(await screen.findByTestId('week-scroll')).toBeInTheDocument();
  });
});
