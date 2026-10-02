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
    if (url.includes('/gantt/options')) return route.fulfill({ json: { projects:[{id:'p1',name:'測試案'}],pms:[],resources:[{id:'r1',name:'測試工程師'}],disciplines:[] } });
    if (url.includes('/gantt/tasks/')) return route.fulfill({ json: { task:{ ...task('A'), project_name:'測試案', description:null, percent_complete:0, duration_minutes:480 }, assignments:[] } });
    if (url.includes('/workload/export')) return route.fulfill({ contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="workload.csv"' }, body: 'type,name\r\nresource,測試工程師\r\n' });
    await route.fulfill({ json: url.includes('/gantt') ? gantt : url.includes('/workload/resources/') ? resource : url.includes('/workload') ? workload : weekly });
  });
}

test('cross-page keyboard, visible dependencies, drill-down, download and desktop layout', async ({ page }, testInfo) => {
  await fixtures(page); await page.goto('/');
  await expect(page.getByTestId('dep-line')).toBeVisible();
  await expect(page.getByTestId('dep-line')).toHaveAttribute('d', /^M /);
  await expect(page.getByTestId('timeline-header')).toBeVisible();
  await page.getByRole('button', {name:'工作 A', exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'工作 A',exact:true})).toBeFocused();
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

test('5000-task Gantt bounds mounted rows and reaches the final task by native scrolling', async({page})=>{
 await page.route('**/api/v1/**',route=>route.fulfill({json:route.request().url().includes('/options')
  ? {projects:[],pms:[],resources:[],disciplines:[]}
  : {...gantt,projects:[{...gantt.projects[0],dependencies:[],tasks:Array.from({length:5000},(_,i)=>task(String(i).padStart(5,'0')))}]}}));
 await page.goto('/');
 await expect(page.getByTestId('task-row').first()).toBeVisible();
 expect(await page.getByTestId('task-row').count()).toBeLessThan(60);
 await page.getByTestId('timeline-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await expect(page.getByRole('button',{name:'工作 04999',exact:true})).toBeVisible();
 expect(await page.getByTestId('task-row').count()).toBeLessThan(60);
 await page.getByTestId('timeline-scroll').evaluate(el=>{el.scrollTop=0;});
 await expect(page.getByRole('button',{name:'工作 00000',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'收合 案件 測試案',exact:true}).click();
 await expect(page.getByTestId('task-row')).toHaveCount(0);
 await page.getByRole('button',{name:'展開 案件 測試案',exact:true}).click();
 await expect(page.getByRole('button',{name:'工作 00000',exact:true})).toBeVisible();
});

test('all dashboard pages pass WCAG 2.1 AA automated checks and source-dialog keyboard flow',async({page},testInfo)=>{
 const {default:AxeBuilder}=await import('@axe-core/playwright');
 await fixtures(page);
 await page.route('**/weekly/options',r=>r.fulfill({json:{projects:[{id:'p1',name:'測試案'}],owners:[]}}));
 await page.route('**/workload/options',r=>r.fulfill({json:{projects:[{id:'p1',name:'測試案'}],resources:[{id:'r1',name:'測試工程師'}],teams:[]}}));
 await page.route('**/weekly/sources/**',r=>r.fulfill({json:{kind:'deliverable',source:{title:'正式交圖',status:'submitted',revision:'A'},actions:[]}}));
 await page.goto('/');
 for(const nav of ['nav-gantt','nav-workload','nav-weekly']){
  await page.getByTestId(nav).click();await expect(page.getByTestId('state-loading')).toHaveCount(0);
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  await testInfo.attach(`${nav}-axe`,{body:JSON.stringify(results,null,2),contentType:'application/json'});
  expect(results.violations).toEqual([]);
 }
 const button=page.getByRole('button',{name:'查看來源與完成確認：正式交圖'});
 await button.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByText('submitted',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button).toBeFocused();
});

test('partial and large data states retain good B/C records and reach final engineer',async({page})=>{
 await fixtures(page);
 await page.route('**/dashboard/weekly?**',r=>r.fulfill({json:{...weekly,partial_errors:[{kind:'review_step',message:'來源暫時無法載入'}],next_offset:50}}));
 const many=Array.from({length:101},(_,i)=>({...resource,resource_id:`r${i}`,name:`工程師 ${String(i).padStart(3,'0')}`,error:i===0}));
 await page.route('**/dashboard/workload?**',r=>r.fulfill({json:{...workload,resources:many}}));
 await page.goto('/');await page.getByTestId('nav-weekly').click();await expect(page.getByTestId('state-partial')).toBeVisible();await expect(page.getByTestId('partial-placeholder')).toBeVisible();await expect(page.getByTestId('large-volume')).toBeVisible();
 await page.getByTestId('nav-workload').click();await expect(page.getByTestId('state-partial')).toBeVisible();expect(await page.getByTestId('wl-row').count()).toBe(50);
 await page.getByRole('button',{name:'下一頁工程師'}).click();await page.getByRole('button',{name:'下一頁工程師'}).click();await expect(page.getByText('工程師 100',{exact:true})).toBeVisible();
});
