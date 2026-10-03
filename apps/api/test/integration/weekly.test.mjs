// P3-06 週工作衍生與跨週顯示／去重（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, closeDb } from './helpers.mjs';

const has = (list, sk) => list.data.some((x) => x.source_key === sk);

test('P3-06 跨週顯示：工作期間橫跨兩週 → 兩週查詢皆出現；期間外之週不出現', async () => {
  const p = await createProject();
  // 期間 2027-01-07 → 01-13，橫跨 週(01-04..01-11) 與 週(01-11..01-18)
  const c = await api('POST', `/projects/${p}/weekly-items`, {
    body: { title: '跨週交圖', source_key: 'S1', period_start: '2027-01-07T09:00:00+08:00', period_end: '2027-01-13T18:00:00+08:00' },
  });
  assert.equal(c.status, 201);

  const wk1 = await api('GET', `/projects/${p}/weekly-items?week=2027-01-06`);
  const wk2 = await api('GET', `/projects/${p}/weekly-items?week=2027-01-13`);
  const prior = await api('GET', `/projects/${p}/weekly-items?week=2026-12-28`);
  assert.ok(has(wk1.body, 'S1'), '本週(01-04) 應相交顯示');
  assert.ok(has(wk2.body, 'S1'), '次週(01-11) 應相交顯示');
  assert.ok(!has(prior.body, 'S1'), '期間之前的週不應顯示');
});

test('P3-06 逾期未完成：於其後之週持續顯示且置頂；完成後不再顯示', async () => {
  const p = await createProject();
  await api('POST', `/projects/${p}/weekly-items`, {
    body: { title: '逾期送審', source_key: 'S2', period_start: '2027-01-05T09:00:00+08:00', period_end: '2027-01-08T18:00:00+08:00' },
  });
  // 之後的週（01-18..01-25）：期間不相交，但逾期未完成 → 顯示、overdue=true
  let later = await api('GET', `/projects/${p}/weekly-items?week=2027-01-20`);
  const item = later.body.data.find((x) => x.source_key === 'S2');
  assert.ok(item, '逾期未完成應於其後之週顯示');
  assert.equal(item.overdue, true);

  // 標記完成 → completed_at 寫回
  const patched = await api('PATCH', `/projects/${p}/weekly-items/${item.id}`, { body: { status: 'done' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, 'done');
  assert.ok(patched.body.completed_at);

  // 完成後之後的週不再顯示（非相交、且已完成）
  later = await api('GET', `/projects/${p}/weekly-items?week=2027-01-20`);
  assert.ok(!has(later.body, 'S2'), '完成後不應再於其後之週顯示');
});

test('P3-06 去重：同 source_key 重複建立 → 409，僅一列', async () => {
  const p = await createProject();
  const a = await api('POST', `/projects/${p}/weekly-items`, {
    body: { title: '會議', source_key: 'DUP', due_at: '2027-01-06T09:00:00+08:00' },
  });
  assert.equal(a.status, 201);
  const b = await api('POST', `/projects/${p}/weekly-items`, {
    body: { title: '會議-again', source_key: 'DUP', due_at: '2027-01-06T09:00:00+08:00' },
  });
  assert.equal(b.status, 409);
  const all = await api('GET', `/projects/${p}/weekly-items`);
  assert.equal(all.body.data.filter((x) => x.source_key === 'DUP').length, 1);
});

test('P3-06 RBAC 負例：Viewer 建立週工作項 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/weekly-items`, {
    roles: 'Viewer', body: { title: 'x', source_key: 'V1' },
  });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
