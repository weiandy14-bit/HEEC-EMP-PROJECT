import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { WorkloadResponse, WorkloadResource, WorkloadCell } from '../types';

const fetchWorkload = vi.fn();
const fetchWorkloadResource = vi.fn();
const downloadWorkload = vi.fn();
vi.mock('../api', () => ({
  downloadWorkload: (...a: unknown[]) => downloadWorkload(...a),
  fetchWorkload: (...a: unknown[]) => fetchWorkload(...a),
  fetchWorkloadResource: (...a: unknown[]) => fetchWorkloadResource(...a),
}));

import { WorkloadPage, loadBand } from '../WorkloadPage';

const cell = (over: Partial<WorkloadCell> = {}): WorkloadCell => ({
  week: '2027-W10', demand_minutes: 480, capacity_minutes: 2400, load_rate: 0.2, flags: [], sources: [], ...over,
});
function resource(over: Partial<WorkloadResource> = {}): WorkloadResource {
  return {
    resource_id: 'r' + Math.random().toString(36).slice(2, 8), name: '工程師A', max_units: 1, team_id: null,
    cells: [cell(), cell({ week: '2027-W11' }), cell({ week: '2027-W12' }), cell({ week: '2027-W13' })], ...over,
  };
}
function resp(over: Partial<WorkloadResponse> = {}): WorkloadResponse {
  return { weeks: ['2027-W10', '2027-W11', '2027-W12', '2027-W13'], resources: [resource()], unassigned: [], teamSummary: [], ...over };
}
const ok = (body: WorkloadResponse) => Promise.resolve({ status: 200, body });

beforeEach(() => {
  downloadWorkload.mockReset();
  fetchWorkload.mockReset();
  fetchWorkloadResource.mockReset();
  fetchWorkloadResource.mockResolvedValue({ status: 200, body: null }); // 預設：不提供每日明細
  localStorage.clear();
  cleanup();
});

describe('loadBand 分級門檻', () => {
  it('0–80% 正常、>80–100% 偏高、>100% 超載、零容量', () => {
    expect(loadBand(cell({ load_rate: 0.8 }))).toBe('normal');
    expect(loadBand(cell({ load_rate: 0.9 }))).toBe('high');
    expect(loadBand(cell({ load_rate: 1.1 }))).toBe('over');
    expect(loadBand(cell({ capacity_minutes: 0, load_rate: null }))).toBe('zero');
  });
});

describe('P4-C 工程師負荷 UI', () => {
  it('C 矩陣：工程師×週、負荷率文字+分級色帶', async () => {
    const r = resource({
      cells: [cell({ load_rate: 0.8 }), cell({ week: '2027-W11', load_rate: 0.9 }),
        cell({ week: '2027-W12', load_rate: 1.1 }), cell({ week: '2027-W13', load_rate: 0.2 })],
    });
    fetchWorkload.mockReturnValue(ok(resp({ resources: [r] })));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    const row = screen.getByTestId('wl-row');
    const cells = within(row).getAllByTestId('wl-cell');
    expect(cells[0]).toHaveAttribute('data-band', 'normal');
    expect(cells[1]).toHaveAttribute('data-band', 'high');
    expect(cells[2]).toHaveAttribute('data-band', 'over');
    expect(within(cells[1]).getByTestId('cell-pct').textContent).toBe('90%');
  });

  it('C3 衝突：同時投入衝突以徽章呈現', async () => {
    const r = resource({ cells: [cell({ flags: ['simultaneous_conflict'] }), cell(), cell(), cell()] });
    fetchWorkload.mockReturnValue(ok(resp({ resources: [r] })));
    render(<WorkloadPage />);
    expect(await screen.findByTestId('flag-simultaneous_conflict')).toBeInTheDocument();
  });

  it('C4 零容量：以零容量色帶與 — 顯示、不除以零', async () => {
    const r = resource({ cells: [cell({ capacity_minutes: 0, demand_minutes: 120, load_rate: null, flags: ['zero_capacity', 'over_allocated'] }), cell(), cell(), cell()] });
    fetchWorkload.mockReturnValue(ok(resp({ resources: [r] })));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    const firstCell = within(screen.getByTestId('wl-row')).getAllByTestId('wl-cell')[0];
    expect(firstCell).toHaveAttribute('data-band', 'zero');
    expect(within(firstCell).getByTestId('cell-pct').textContent).toBe('—');
  });

  it('C 展開來源：點格顯示案/任務/工時/units；代班標記', async () => {
    const r = resource({ cells: [
      cell({ sources: [{ project_id: 'p1234567', task_id: 't7654321', minutes: 480, assignment_units: 0.5, booking_type: 'cover' }] }),
      cell(), cell(), cell(),
    ] });
    fetchWorkload.mockReturnValue(ok(resp({ resources: [r] })));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    fireEvent.click(screen.getByTestId(`cell-${r.resource_id}:0`));
    expect(await screen.findByTestId('cell-sources')).toBeInTheDocument();
    expect(screen.getByTestId('source-row')).toBeInTheDocument();
    expect(screen.getByTestId('tag-cover')).toBeInTheDocument();
  });

  it('C drill-down 每日明細：展開格時載入並顯示逐日列', async () => {
    const r = resource();
    fetchWorkload.mockReturnValue(ok(resp({ resources: [r] })));
    const detail = {
      ...r,
      cells: r.cells.map((c, i) => (i === 0
        ? { ...c, days: [
            { date: '2027-03-15', capacity_minutes: 480, demand_minutes: 480, load_rate: 1, flags: [] },
            { date: '2027-03-16', capacity_minutes: 480, demand_minutes: 0, load_rate: 0, flags: [] },
          ] }
        : c)),
    };
    fetchWorkloadResource.mockReturnValue(Promise.resolve({ status: 200, body: detail }));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    fireEvent.click(screen.getByTestId(`cell-${r.resource_id}:0`));
    expect(await screen.findByTestId('cell-days')).toBeInTheDocument();
    expect(screen.getAllByTestId('day-row')).toHaveLength(2);
    expect(fetchWorkloadResource).toHaveBeenCalledWith(r.resource_id, expect.any(Object));
  });

  it('daily detail error offers retry while weekly data remains visible', async () => {
    const r = resource();
    fetchWorkload.mockReturnValue(ok(resp({ resources: [r] })));
    fetchWorkloadResource.mockRejectedValueOnce(new Error('connection failed'));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    fireEvent.click(screen.getByTestId(`cell-${r.resource_id}:0`));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection failed');
    expect(screen.getByTestId('workload')).toBeInTheDocument();
    fetchWorkloadResource.mockResolvedValueOnce({ status: 200, body: { ...r, cells: r.cells.map((c) => ({ ...c, days: [] })) } });
    fireEvent.click(screen.getByRole('button', { name: '重試每日明細' }));
    expect(await screen.findByTestId('cell-days')).toBeInTheDocument();
  });

  it('C6 export uses active filters and reports failures', async () => {
    fetchWorkload.mockReturnValue(ok(resp()));
    downloadWorkload.mockRejectedValueOnce(new Error('匯出失敗 HTTP 403'));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    fireEvent.click(screen.getByRole('button', { name: '匯出負荷 CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('匯出失敗 HTTP 403');
    expect(downloadWorkload).toHaveBeenCalledWith({});
  });

  it('C6 未指派清單', async () => {
    fetchWorkload.mockReturnValue(ok(resp({
      unassigned: [{ project_id: 'p1', task_id: 't1', wbs_code: '1.2', name: '待分派圖', planned_start: null, planned_finish: null, duration_minutes: 480 }],
    })));
    render(<WorkloadPage />);
    expect(await screen.findByTestId('unassigned')).toBeInTheDocument();
    expect(screen.getByTestId('unassigned-row')).toHaveTextContent('待分派圖');
  });

  it('U1/U2/U3/U4 狀態', async () => {
    // 載入
    fetchWorkload.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<WorkloadPage />);
    expect(screen.getByTestId('state-loading')).toBeInTheDocument();
    unmount(); cleanup();
    // 空
    fetchWorkload.mockReturnValue(ok(resp({ resources: [] })));
    render(<WorkloadPage />);
    expect(await screen.findByTestId('state-empty')).toBeInTheDocument();
    cleanup();
    // 無權限
    fetchWorkload.mockReturnValue(Promise.resolve({ status: 403, body: null }));
    render(<WorkloadPage />);
    expect(await screen.findByTestId('state-no-permission')).toBeInTheDocument();
    cleanup();
    // 錯誤 + 重試
    fetchWorkload.mockRejectedValueOnce(new Error('x'));
    render(<WorkloadPage />);
    expect(await screen.findByTestId('state-error')).toBeInTheDocument();
    fetchWorkload.mockReturnValue(ok(resp()));
    fireEvent.click(screen.getByText('重試'));
    expect(await screen.findByTestId('workload')).toBeInTheDocument();
  });

  it('U7：16:9 主框架 + 可捲動矩陣容器', async () => {
    fetchWorkload.mockReturnValue(ok(resp()));
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    expect(screen.getByTestId('app-frame')).toBeInTheDocument();
    expect(screen.getByTestId('workload-scroll')).toBeInTheDocument();
  });

  it('A6/C 儲存檢視：起始週寫入並重開還原', async () => {
    fetchWorkload.mockReturnValue(ok(resp()));
    const { unmount } = render(<WorkloadPage />);
    await screen.findByTestId('workload');
    fireEvent.change(screen.getByTestId('filter-from-week'), { target: { value: '2027-W20' } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('workload.view.v1')!).from_week).toBe('2027-W20'));
    unmount();
    render(<WorkloadPage />);
    await screen.findByTestId('workload');
    expect(screen.getByTestId('filter-from-week')).toHaveValue('2027-W20');
  });
});
