// P3-07 警示引擎去重與分級（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb } from './helpers.mjs';

const evalBody = (over = {}) => ({ entity_type: 'task', period: '2027-W02', ...over });

test('P3-07 分級：落後 3 工作日 → attention', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 3 }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.severity, 'attention');
});

test('P3-07 分級：落後 4 工作日 → behind', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) });
  assert.equal(r.body.severity, 'behind');
});

test('P3-07 分級：已逾計畫完成且未完成 → overdue', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ overdue: true }) });
  assert.equal(r.body.severity, 'overdue');
});

test('P3-07 分級：逾期且落後≥4 同時成立 → overdue（優先）', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ overdue: true, late_working_days: 5 }) });
  assert.equal(r.body.severity, 'overdue');
});

test('P3-07 去重：同指紋再評估 → occurrence_count=2，不重建', async () => {
  const p = await createProject();
  const a = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4, entity_id: undefined }) });
  const b = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4, entity_id: undefined }) });
  assert.equal(a.body.id, b.body.id); // 同一列
  assert.equal(b.body.occurrence_count, 2);
  const list = await api('GET', `/projects/${p}/alerts`);
  assert.equal(list.body.data.length, 1);
});

test('P3-07 ack 需理由：缺理由 422、具理由 → ack 並記歷史', async () => {
  const p = await createProject();
  const alertId = (await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) })).body.id;
  const noReason = await api('POST', `/projects/${p}/alerts/${alertId}/ack`, { body: {} });
  assert.equal(noReason.status, 400); // class-validator 缺必填
  const ok = await api('POST', `/projects/${p}/alerts/${alertId}/ack`, { body: { reason: '已知悉，處理中' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.state, 'ack');
  const hist = await db().query(`SELECT action FROM audit_logs WHERE entity_type='alert' AND entity_id=$1 AND action='ack'`, [alertId]);
  assert.equal(hist.rows.length, 1);
});

test('P3-07 snooze 需理由+到期：缺到期 422、齊備 → snoozed', async () => {
  const p = await createProject();
  const alertId = (await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) })).body.id;
  const noUntil = await api('POST', `/projects/${p}/alerts/${alertId}/snooze`, { body: { reason: '暫緩' } });
  assert.equal(noUntil.status, 400);
  const ok = await api('POST', `/projects/${p}/alerts/${alertId}/snooze`, { body: { reason: '暫緩至下週', snooze_until: '2027-01-20T00:00:00+08:00' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.state, 'snoozed');
  assert.ok(ok.body.snooze_until);
});

test('P3-07 close 保留 + 條件再現建新列：close 需理由，之後同指紋 → 新列 occurrence=1', async () => {
  const p = await createProject();
  const first = (await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) })).body;
  const closed = await api('POST', `/projects/${p}/alerts/${first.id}/close`, { body: { reason: '已解除' } });
  assert.equal(closed.status, 201);
  assert.equal(closed.body.state, 'closed');
  // 條件再現：同指紋再評估 → 因部分唯一索引排除 closed，建立新列
  const again = (await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) })).body;
  assert.notEqual(again.id, first.id);
  assert.equal(again.occurrence_count, 1);
  // close 歷史保留
  const hist = await db().query(`SELECT action FROM audit_logs WHERE entity_type='alert' AND entity_id=$1 AND action='close'`, [first.id]);
  assert.equal(hist.rows.length, 1);
});

test('P3-07 RBAC 負例：Viewer 評估警示 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { roles: 'Viewer', body: evalBody({ late_working_days: 4 }) });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
