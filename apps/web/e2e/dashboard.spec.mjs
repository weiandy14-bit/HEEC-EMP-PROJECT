import { test, expect } from '@playwright/test';

const task = (id, parent_id = null) => ({
  id, parent_id, wbs_code: id, name: `工作 ${id}`, critical: false, status: 'not_started',
  planned: { start: '2026-01-01T01:00:00Z', finish: '2027-12-31T10:00:00Z' },
  baseline: { start: null, finish: null }, actual: { start: null, finish: null },
});
const gantt = { next_cursor: null, projects: [{ id: 'p1', code: 'P1', name: '測試案', health: 'normal',
  tasks: [task('A'), task('B', 'A')], milestones: [],
  dependencies: [{ id: 'd1', predecessor_id: 'A', successor_id: 'B', relation: 'FS', lag_minutes: 0 }] }] };
const cells = [10, 11, 12, 13].map((w) => ({ week: `2027-W${w}`, demand_minutes: 480,
  capacity_minutes: 2400, load_rate: .2, flags: [], sources: [],
  days: [{ date: '2027-03-08', demand_minutes: 0, capacity_minutes: 0, load_rate: null, flags: ['on_leave', 'zero_capacity'] }] }));
const resource = { resource_id: 'r1', name: '測試工程師', max_units: 1, team_id: null, cells };
const workload = { weeks: cells.map((c) => c.week), resources: [resource], unassigned: [], teamSummary: [] };
const weekly = { weekStart: '2027-03-08', weekEnd: '2027-03-13', items: [{ id: 'w1', type: '交圖', title: '正式交圖',
  project_id: 'p1', project_name: '測試案', assignee_id: null, assignee_name: null, source: { kind: 'deliverable', id: 's1' },
  due_at: '2027-03-08T01:00:00Z', status: 'open', overdue: false }] };

async function fixtures(page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/workload/export')) return route.fulfill({ contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="workload.csv"' }, body: 'type,name\r\nresource,測試工程師\r\n' });
    await route.fulfill({ json: url.includes('/gantt') ? gantt : url.includes('/workload/resources/') ? resource : url.includes('/workload') ? workload : weekly });
  });
}

test('cross-page keyboard, visible dependencies, drill-down, download and desktop layout', async ({ page }, testInfo) => {
  await fixtures(page); await page.goto('/');
  await expect(page.getByTestId('dep-line')).toBeVisible();
  await expect(page.getByTestId('dep-line')).toHaveAttribute('d', /^M /);
  const toggle = page.getByRole('button', { name: '收合 工作 A' });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('工作 B', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '展開 工作 A' }).press('Enter');
  await page.getByTestId('zoom-day').click();
  const scroll = page.getByTestId('timeline-scroll');
  const leftBefore = await page.getByTestId('name-col').first().boundingBox();
  await scroll.evaluate((el) => { el.scrollLeft = 500; });
  const leftAfter = await page.getByTestId('name-col').first().boundingBox();
  expect(Math.abs(leftBefore.x - leftAfter.x)).toBeLessThan(1);
  for (const nav of ['nav-gantt', 'nav-workload', 'nav-weekly']) {
    await page.getByTestId(nav).click();
    await expect(page.getByTestId(nav === 'nav-gantt' ? 'gantt' : nav === 'nav-workload' ? 'workload' : 'week-scroll')).toBeVisible();
    await expect(page.getByTestId('app-frame')).toBeVisible();
    const box = await page.getByTestId('app-frame').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
    await page.screenshot({ path: testInfo.outputPath(`${nav}.png`) });
  }
  await page.getByTestId('nav-workload').click();
  const firstWeekHeader = await page.getByRole('columnheader', { name: '2027-W10' }).boundingBox();
  const firstWeekCell = await page.getByTestId('wl-cell').first().boundingBox();
  expect(Math.abs(firstWeekHeader.x - firstWeekCell.x)).toBeLessThan(1);
  await page.getByTestId('cell-r1:0').press('Enter');
  await expect(page.getByTestId('cell-days')).toContainText('請假');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出負荷 CSV' }).click();
  expect((await downloading).suggestedFilename()).toBe('workload.csv');
});

for (const [nav, path, empty] of [
  ['nav-gantt', '/gantt', { projects: [] }],
  ['nav-workload', '/workload', { weeks: [], resources: [], unassigned: [], teamSummary: [] }],
  ['nav-weekly', '/weekly', { weekStart: '2027-03-08', weekEnd: '2027-03-13', items: [] }],
]) {
  test(`${nav}: loading, empty, forbidden, failure and retry`, async ({ page }) => {
    await fixtures(page);
    let mode = 'loading';
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route(`**/api/v1/dashboard${path}?*`, async (route) => {
      if (mode === 'loading') await pending;
      if (mode === 'empty') return route.fulfill({ json: empty });
      if (mode === 'forbidden') return route.fulfill({ status: 403, json: { message: 'forbidden' } });
      if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'unavailable' } });
      return route.fulfill({ json: path === '/gantt' ? gantt : path === '/workload' ? workload : weekly });
    });
    await page.goto('/'); if (nav !== 'nav-gantt') await page.getByTestId(nav).click();
    await expect(page.getByTestId('state-loading')).toBeVisible();
    mode = 'empty'; release();
    await expect(page.getByTestId('state-empty')).toBeVisible();
    mode = 'forbidden'; await page.reload(); if (nav !== 'nav-gantt') await page.getByTestId(nav).click();
    await expect(page.getByTestId('state-no-permission')).toBeVisible();
    mode = 'error'; await page.reload(); if (nav !== 'nav-gantt') await page.getByTestId(nav).click();
    await expect(page.getByTestId('state-error')).toBeVisible();
    mode = 'ok'; await page.getByRole('button', { name: '重試' }).click();
    await expect(page.getByTestId('state-error')).toHaveCount(0);
  });
}
