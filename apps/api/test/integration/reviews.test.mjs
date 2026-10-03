// P3-01 法定審查適用性狀態機（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb, FIRE_TEMPLATE } from './helpers.mjs';

test('P3-01a 負例：not_applicable 無理由 → 422 validation', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'not_applicable' },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.category, 'validation');
});

test('P3-01b 負例：pending 無責任人/期限 → 422 validation', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'pending' },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.category, 'validation');
});

test('P3-01c 正例：applicable + authority → 201，並寫入稽核與 review_events', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.applicability, 'applicable');
  assert.equal(r.body.authority, '消防局');
  const reviewId = r.body.id;

  // 稽核可查：audit_logs 與 review_events 各有對應紀錄
  const audit = await db().query(
    `SELECT action, integrity_hash FROM audit_logs WHERE entity_type='statutory_review' AND entity_id=$1`,
    [reviewId],
  );
  assert.ok(audit.rows.length >= 1, '應有稽核紀錄');
  assert.ok(audit.rows[0].integrity_hash, 'integrity_hash 應存在（hash chain）');
  const ev = await db().query(
    `SELECT event_type FROM review_events WHERE review_id=$1 AND event_type='created'`,
    [reviewId],
  );
  assert.equal(ev.rows.length, 1);
});

test('P3-01 正例：pending 具責任人與期限 → 201', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: {
      template_id: FIRE_TEMPLATE, applicability: 'pending',
      confirmation_owner_id: '22222222-2222-4222-8222-222222222222',
      confirmation_due_date: '2027-01-05',
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.applicability, 'pending');
});

test('P3-01 正例：not_applicable 具理由 → 201、status=na', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'not_applicable', na_reason: '本案無消防範圍' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'na');
});

test('P3-01 PATCH：pending→applicable，記 applicability_changed 事件', async () => {
  const p = await createProject();
  const created = await api('POST', `/projects/${p}/reviews`, {
    body: {
      template_id: FIRE_TEMPLATE, applicability: 'pending',
      confirmation_owner_id: '22222222-2222-4222-8222-222222222222',
      confirmation_due_date: '2027-01-05',
    },
  });
  const reviewId = created.body.id;
  const patched = await api('PATCH', `/projects/${p}/reviews/${reviewId}`, {
    body: { applicability: 'applicable', authority: '消防局' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.applicability, 'applicable');
  const ev = await db().query(
    `SELECT event_type FROM review_events WHERE review_id=$1 AND event_type='applicability_changed'`,
    [reviewId],
  );
  assert.equal(ev.rows.length, 1);
});

test('P3-01 RBAC 負例：Engineer 建立審查 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    roles: 'Engineer',
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable' },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.category, 'authorization');
});

test('P3-01 列表：建立後可於清單查得', async () => {
  const p = await createProject();
  await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable' },
  });
  const list = await api('GET', `/projects/${p}/reviews`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].template_id, FIRE_TEMPLATE);
});

test.after(async () => { await closeDb(); });
