// P3-04 交付物狀態流轉與版本（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb } from './helpers.mjs';

test('P3-04 狀態流轉：draft→submitted→accepted→locked，時間戳寫回', async () => {
  const p = await createProject();
  const c = await api('POST', `/projects/${p}/deliverables`, { body: { name: '消防圖', due_at: '2027-02-01' } });
  assert.equal(c.status, 201);
  assert.equal(c.body.status, 'draft');
  assert.equal(c.body.revision, 'A');
  const id = c.body.id;

  let r = await api('PATCH', `/projects/${p}/deliverables/${id}`, { body: { status: 'submitted' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.submitted_at);
  r = await api('PATCH', `/projects/${p}/deliverables/${id}`, { body: { status: 'accepted' } });
  assert.equal(r.body.status, 'accepted');
  assert.ok(r.body.accepted_at);
  r = await api('PATCH', `/projects/${p}/deliverables/${id}`, { body: { status: 'locked' } });
  assert.equal(r.body.status, 'locked');
  assert.ok(r.body.locked_at);
});

test('P3-04 負例：locked 交付物直接 PATCH → 409', async () => {
  const p = await createProject();
  const id = (await api('POST', `/projects/${p}/deliverables`, { body: { name: '鎖定圖' } })).body.id;
  await api('PATCH', `/projects/${p}/deliverables/${id}`, { body: { status: 'locked' } });
  const r = await api('PATCH', `/projects/${p}/deliverables/${id}`, { body: { status: 'draft' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.category, 'conflict');
});

test('P3-04 正例：locked 之後續變更建立新 revision，原版不變', async () => {
  const p = await createProject();
  const id = (await api('POST', `/projects/${p}/deliverables`, { body: { name: '版本圖' } })).body.id;
  await api('PATCH', `/projects/${p}/deliverables/${id}`, { body: { status: 'locked' } });
  const rev = await api('POST', `/projects/${p}/deliverables/${id}/revise`, { body: {} });
  assert.equal(rev.status, 201);
  assert.equal(rev.body.revision, 'B');
  assert.equal(rev.body.status, 'draft');
  // 原版（rev A）仍為 locked、未被更動
  const list = await api('GET', `/projects/${p}/deliverables`);
  const a = list.body.data.find((x) => x.revision === 'A');
  const b = list.body.data.find((x) => x.revision === 'B');
  assert.equal(a.status, 'locked');
  assert.equal(b.status, 'draft');
});

test('P3-04 負例：同 name+revision 重複建立 → 409', async () => {
  const p = await createProject();
  await api('POST', `/projects/${p}/deliverables`, { body: { name: '唯一圖', revision: 'A' } });
  const dup = await api('POST', `/projects/${p}/deliverables`, { body: { name: '唯一圖', revision: 'A' } });
  assert.equal(dup.status, 409);
});

test('P3-04 DELETE 採封存：列表移除、資料列與稽核保留', async () => {
  const p = await createProject();
  const id = (await api('POST', `/projects/${p}/deliverables`, { body: { name: '待封存圖' } })).body.id;
  const del = await api('DELETE', `/projects/${p}/deliverables/${id}`);
  assert.equal(del.status, 204);
  // 列表不再顯示
  const list = await api('GET', `/projects/${p}/deliverables`);
  assert.equal(list.body.data.find((x) => x.id === id), undefined);
  // 資料列仍在（archived_at 已設）
  const row = await db().query(`SELECT archived_at FROM deliverables WHERE id=$1`, [id]);
  assert.equal(row.rows.length, 1);
  assert.ok(row.rows[0].archived_at, 'archived_at 應已設定');
  // 稽核保留封存事件
  const audit = await db().query(
    `SELECT action FROM audit_logs WHERE entity_type='deliverable' AND entity_id=$1 AND action='archive'`,
    [id],
  );
  assert.equal(audit.rows.length, 1);
});

test('P3-04 RBAC 負例：Viewer 建立交付物 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/deliverables`, { roles: 'Viewer', body: { name: 'x' } });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
