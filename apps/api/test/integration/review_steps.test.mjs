// P3-02 送審／補正多輪循環（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb, FIRE_TEMPLATE } from './helpers.mjs';

async function newReview() {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局' },
  });
  assert.equal(r.status, 201);
  return { projectId: p, reviewId: r.body.id };
}

test('P3-02 送審→補正→再送審：cycle_no 遞增、前輪不被覆寫', async () => {
  const { projectId, reviewId } = await newReview();

  // 第一輪送審（cycle 自動 = 1）
  const s1 = await api('POST', `/projects/${projectId}/reviews/${reviewId}/steps`, {
    body: { step_code: 'SUBMIT' },
  });
  assert.equal(s1.status, 201);
  assert.equal(s1.body.cycle_no, 1);
  assert.equal(s1.body.status, 'submitted');

  // 補正：第一輪轉 revision
  const patched = await api('PATCH', `/projects/${projectId}/reviews/${reviewId}/steps/${s1.body.id}`, {
    body: { status: 'revision' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, 'revision');

  // 再送審（cycle 自動 = 2）
  const s2 = await api('POST', `/projects/${projectId}/reviews/${reviewId}/steps`, {
    body: { step_code: 'SUBMIT' },
  });
  assert.equal(s2.status, 201);
  assert.equal(s2.body.cycle_no, 2);
  assert.equal(s2.body.status, 'submitted');

  // 前輪（cycle 1）歷史保留、未被覆寫：仍為 revision
  const list = await api('GET', `/projects/${projectId}/reviews/${reviewId}/steps`);
  assert.equal(list.status, 200);
  const submits = list.body.data.filter((x) => x.step_code === 'SUBMIT').sort((a, b) => a.cycle_no - b.cycle_no);
  assert.equal(submits.length, 2);
  assert.equal(submits[0].cycle_no, 1);
  assert.equal(submits[0].status, 'revision');
  assert.equal(submits[1].cycle_no, 2);
  assert.equal(submits[1].status, 'submitted');

  // review_events：兩次 step_created + 一次 step_status_changed
  const created = await db().query(
    `SELECT count(*)::int AS n FROM review_events WHERE review_id=$1 AND event_type='step_created'`,
    [reviewId],
  );
  assert.equal(created.rows[0].n, 2);
  const changed = await db().query(
    `SELECT count(*)::int AS n FROM review_events WHERE review_id=$1 AND event_type='step_status_changed'`,
    [reviewId],
  );
  assert.equal(changed.rows[0].n, 1);
});

test('P3-02 負例：同 (review, cycle, step_code) 重複建立 → 409', async () => {
  const { projectId, reviewId } = await newReview();
  const a = await api('POST', `/projects/${projectId}/reviews/${reviewId}/steps`, {
    body: { step_code: 'SUBMIT', cycle_no: 1 },
  });
  assert.equal(a.status, 201);
  const dup = await api('POST', `/projects/${projectId}/reviews/${reviewId}/steps`, {
    body: { step_code: 'SUBMIT', cycle_no: 1 },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.category, 'conflict');
});

test('P3-02 RBAC 負例：Engineer 建立步驟 → 403', async () => {
  const { projectId, reviewId } = await newReview();
  const r = await api('POST', `/projects/${projectId}/reviews/${reviewId}/steps`, {
    roles: 'Engineer',
    body: { step_code: 'SUBMIT' },
  });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
