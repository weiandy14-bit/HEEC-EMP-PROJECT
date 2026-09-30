// P3-03 核可需文號＋日期（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, closeDb, FIRE_TEMPLATE } from './helpers.mjs';

async function newReview() {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/reviews`, {
    body: { template_id: FIRE_TEMPLATE, applicability: 'applicable', authority: '消防局' },
  });
  assert.equal(r.status, 201);
  return { projectId: p, reviewId: r.body.id };
}

test('P3-03 負例：approved 缺文號 → 422', async () => {
  const { projectId, reviewId } = await newReview();
  const r = await api('PATCH', `/projects/${projectId}/reviews/${reviewId}`, {
    body: { status: 'approved', approval_date: '2027-02-01' },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.category, 'validation');
});

test('P3-03 負例：approved 缺日期 → 422', async () => {
  const { projectId, reviewId } = await newReview();
  const r = await api('PATCH', `/projects/${projectId}/reviews/${reviewId}`, {
    body: { status: 'approved', approval_number: '消字第123號' },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.category, 'validation');
});

test('P3-03 正例：approved 具文號+日期 → 200、status=approved', async () => {
  const { projectId, reviewId } = await newReview();
  const r = await api('PATCH', `/projects/${projectId}/reviews/${reviewId}`, {
    body: { status: 'approved', approval_number: '消字第123號', approval_date: '2027-02-01' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'approved');
  assert.equal(r.body.approval_number, '消字第123號');
});

test('P3-03 RBAC：QA 可核准（審核 A）', async () => {
  const { projectId, reviewId } = await newReview();
  const r = await api('PATCH', `/projects/${projectId}/reviews/${reviewId}`, {
    roles: 'QA',
    body: { status: 'approved', approval_number: '消字第999號', approval_date: '2027-02-02' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'approved');
});

test('P3-03 RBAC 負例：Engineer 核准 → 403', async () => {
  const { projectId, reviewId } = await newReview();
  const r = await api('PATCH', `/projects/${projectId}/reviews/${reviewId}`, {
    roles: 'Engineer',
    body: { status: 'approved', approval_number: 'X', approval_date: '2027-02-01' },
  });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
