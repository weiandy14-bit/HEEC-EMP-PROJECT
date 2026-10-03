// P3-09 RBAC 與跨案 IDOR（整合測試，真實 DB）
// 權限負例 → 403；跨案存取 → 404（不洩存在性）。全 Phase 3 端點逐類覆蓋。
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb, FIRE_TEMPLATE } from './helpers.mjs';

// 建各類資源於指定專案，回傳其 id（以具權限角色建立）
async function makeReview(p) {
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局' },
  });
  assert.equal(r.status, 201, 'makeReview: ' + JSON.stringify(r.body));
  return r.body.id;
}
async function makeDeliverable(p) {
  const r = await api('POST', `/projects/${p}/deliverables`, { body: { name: '消防圖', due_at: '2027-02-01' } });
  assert.equal(r.status, 201, 'makeDeliverable: ' + JSON.stringify(r.body));
  return r.body.id;
}
async function makeMeeting(p) {
  const r = await api('POST', `/projects/${p}/meetings`, {
    body: { starts_at: '2027-01-10T09:00:00+08:00', ends_at: '2027-01-10T10:00:00+08:00', topic: '啟動會議' },
  });
  assert.equal(r.status, 201, 'makeMeeting: ' + JSON.stringify(r.body));
  return r.body.id;
}
async function makeWeekly(p) {
  const r = await api('POST', `/projects/${p}/weekly-items`, {
    body: { title: '跨週交圖', source_key: 'IDOR', period_start: '2027-01-07T09:00:00+08:00', period_end: '2027-01-13T18:00:00+08:00' },
  });
  assert.equal(r.status, 201, 'makeWeekly: ' + JSON.stringify(r.body));
  return r.body.id;
}
async function makeAlert(p) {
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, {
    body: { entity_type: 'task', period: '2027-W02', late_working_days: 4 },
  });
  assert.equal(r.status, 201, 'makeAlert: ' + JSON.stringify(r.body));
  return r.body.id;
}

// ---------- RBAC 權限負例（→ 403） ----------

test('P3-09 RBAC：Engineer 修改審查（核准） → 403', async () => {
  const p = await createProject();
  const rid = await makeReview(p);
  const r = await api('PATCH', `/projects/${p}/reviews/${rid}`, {
    roles: 'Engineer', body: { status: 'approved', approval_number: 'A-1', approval_date: '2027-02-01' },
  });
  assert.equal(r.status, 403);
});

test('P3-09 RBAC：Viewer 建立交付物 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/deliverables`, { roles: 'Viewer', body: { name: '圖' } });
  assert.equal(r.status, 403);
});

test('P3-09 RBAC：Viewer 建立會議 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/meetings`, {
    roles: 'Viewer', body: { starts_at: '2027-01-10T09:00:00+08:00', topic: 'x' },
  });
  assert.equal(r.status, 403);
});

test('P3-09 RBAC：Viewer 建立審查 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    roles: 'Viewer', body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局' },
  });
  assert.equal(r.status, 403);
});

test('P3-09 RBAC：Viewer 建立週工作項 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/weekly-items`, {
    roles: 'Viewer', body: { title: 'x', source_key: 'V' },
  });
  assert.equal(r.status, 403);
});

// GET（唯讀）Viewer 應可讀 → 確認唯讀角色仍具讀取（避免過度限制）
test('P3-09 RBAC：Viewer 可讀取交付物清單 → 200', async () => {
  const p = await createProject();
  const r = await api('GET', `/projects/${p}/deliverables`, { roles: 'Viewer' });
  assert.equal(r.status, 200);
});

// ---------- 跨案 IDOR（B 案資源以 A 案 URL 存取 → 404，不洩存在性） ----------

test('P3-09 IDOR：以 A 案 URL 存取 B 案審查 → 404', async () => {
  const a = await createProject();
  const b = await createProject();
  const rid = await makeReview(b);
  const get = await api('GET', `/projects/${a}/reviews/${rid}/steps`);
  assert.equal(get.status, 404);
  const patch = await api('PATCH', `/projects/${a}/reviews/${rid}`, { body: { notes: '越權嘗試' } });
  assert.equal(patch.status, 404);
});

test('P3-09 IDOR：以 A 案 URL 存取 B 案交付物 → 404', async () => {
  const a = await createProject();
  const b = await createProject();
  const did = await makeDeliverable(b);
  const patch = await api('PATCH', `/projects/${a}/deliverables/${did}`, { body: { status: 'submitted' } });
  assert.equal(patch.status, 404);
  const del = await api('DELETE', `/projects/${a}/deliverables/${did}`, {});
  assert.equal(del.status, 404);
});

test('P3-09 IDOR：以 A 案 URL 存取 B 案會議 → 404', async () => {
  const a = await createProject();
  const b = await createProject();
  const mid = await makeMeeting(b);
  const patch = await api('PATCH', `/projects/${a}/meetings/${mid}`, { body: { status: 'held' } });
  assert.equal(patch.status, 404);
});

test('P3-09 IDOR：以 A 案 URL 存取 B 案週工作項 → 404', async () => {
  const a = await createProject();
  const b = await createProject();
  const wid = await makeWeekly(b);
  const patch = await api('PATCH', `/projects/${a}/weekly-items/${wid}`, { body: { status: 'done' } });
  assert.equal(patch.status, 404);
});

test('P3-09 IDOR：以 A 案 URL 操作 B 案警示 → 404', async () => {
  const a = await createProject();
  const b = await createProject();
  const aid = await makeAlert(b);
  const ack = await api('POST', `/projects/${a}/alerts/${aid}/ack`, { body: { reason: '越權嘗試' } });
  assert.equal(ack.status, 404);
});

// IDOR 不得旁路：確認 B 案資源在其本案 URL 下仍可正常存取（對照組）
test('P3-09 IDOR 對照：B 案資源於本案 URL 可正常存取 → 非 404', async () => {
  const b = await createProject();
  const did = await makeDeliverable(b);
  const ok = await api('PATCH', `/projects/${b}/deliverables/${did}`, { body: { status: 'submitted' } });
  assert.notEqual(ok.status, 404);
  assert.ok(ok.status < 300, '本案存取應成功: ' + JSON.stringify(ok.body));
});

test.after(async () => { await closeDb(); });
