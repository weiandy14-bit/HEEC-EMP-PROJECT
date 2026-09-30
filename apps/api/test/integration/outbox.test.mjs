// P3-08 專案健康度 + 交易性 outbox（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb } from './helpers.mjs';

const evalBody = (over = {}) => ({ entity_type: 'task', period: '2027-W02', ...over });

test('P3-08 健康度：評估 behind → project.health=behind', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.severity, 'behind');
  assert.equal(r.body.project_health, 'behind');
  const row = await db().query(`SELECT health FROM projects WHERE id=$1`, [p]);
  assert.equal(row.rows[0].health, 'behind');
});

test('P3-08 健康度：overdue 取最高；關閉後回落 normal（同交易重算）', async () => {
  const p = await createProject();
  const a = (await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ overdue: true }) })).body;
  assert.equal(a.project_health, 'overdue');
  const closed = await api('POST', `/projects/${p}/alerts/${a.id}/close`, { body: { reason: '已解除' } });
  assert.equal(closed.status, 201);
  assert.equal(closed.body.project_health, 'normal');
  const row = await db().query(`SELECT health FROM projects WHERE id=$1`, [p]);
  assert.equal(row.rows[0].health, 'normal');
});

test('P3-08 同交易：評估成功則 alert 與 outbox 事件同時存在（可原子觀察）', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ late_working_days: 4 }) });
  assert.equal(r.status, 201);
  assert.ok(r.body.event_id, '回傳含 event_id');
  const job = await db().query(
    `SELECT id, aggregate_id, type, state FROM job_outbox WHERE event_id=$1`, [r.body.event_id]);
  assert.equal(job.rows.length, 1);
  assert.equal(job.rows[0].aggregate_id, r.body.id); // 事件指向該 alert
  assert.equal(job.rows[0].type, 'alert.raised');
});

test('P3-08 原子性：評估失敗（規則不存在）→ 不留下 alert 或 outbox 事件', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/alerts/evaluate`, { body: evalBody({ rule_code: 'NO_SUCH_RULE', late_working_days: 4 }) });
  assert.equal(r.status, 422);
  const alerts = await db().query(`SELECT count(*)::int n FROM alerts WHERE project_id=$1`, [p]);
  assert.equal(alerts.rows[0].n, 0);
  const jobs = await db().query(
    `SELECT count(*)::int n FROM job_outbox WHERE aggregate_type='alert' AND payload->>'project_id'=$1`, [p]);
  assert.equal(jobs.rows[0].n, 0);
});

test('P3-08 worker：正常事件消費一次 → event_effects 恰一筆、job succeeded', async () => {
  const enq = await api('POST', `/internal/outbox/enqueue-test`, { roles: 'Admin', body: {} });
  assert.equal(enq.status, 201);
  const eventId = enq.body.event_id;
  const proc = await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: {} });
  assert.equal(proc.status, 201);
  const eff = await db().query(`SELECT count(*)::int n FROM event_effects WHERE event_id=$1`, [eventId]);
  assert.equal(eff.rows[0].n, 1);
  const job = await db().query(`SELECT state FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'succeeded');
});

test('P3-08 冪等：同 event_id 重投 → 效果不重複套用', async () => {
  const enq = (await api('POST', `/internal/outbox/enqueue-test`, { roles: 'Admin', body: {} })).body;
  const eventId = enq.event_id;
  await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: {} });
  // 模擬重投：worker 於套用效果後、標記完成前崩潰重啟 → 事件再次可派
  await db().query(`UPDATE job_outbox SET state='pending', available_at=now() WHERE event_id=$1`, [eventId]);
  const proc2 = await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: {} });
  const mine = proc2.body.results.find((x) => x.event_id === eventId);
  assert.equal(mine.applied, false); // 第二次未套用（event_id 已消費）
  const eff = await db().query(`SELECT count(*)::int n FROM event_effects WHERE event_id=$1`, [eventId]);
  assert.equal(eff.rows[0].n, 1); // 仍僅一筆
});

test('P3-08 重試/dead-letter：持續失敗達上限 → state=dead，無效果', async () => {
  const enq = (await api('POST', `/internal/outbox/enqueue-test`, { roles: 'Admin', body: { fail: true } })).body;
  const eventId = enq.event_id;
  // 第 1 次失敗 → failed attempts=1
  await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: {} });
  let job = await db().query(`SELECT state, attempts FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'failed');
  assert.equal(job.rows[0].attempts, 1);
  // 模擬退避時間到 → 第 2 次
  await db().query(`UPDATE job_outbox SET available_at=now() WHERE event_id=$1`, [eventId]);
  await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: {} });
  job = await db().query(`SELECT state, attempts FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'failed');
  assert.equal(job.rows[0].attempts, 2);
  // 第 3 次 → 達上限 dead
  await db().query(`UPDATE job_outbox SET available_at=now() WHERE event_id=$1`, [eventId]);
  await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: {} });
  job = await db().query(`SELECT state, attempts, last_error FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'dead');
  assert.equal(job.rows[0].attempts, 3);
  assert.ok(job.rows[0].last_error);
  const eff = await db().query(`SELECT count(*)::int n FROM event_effects WHERE event_id=$1`, [eventId]);
  assert.equal(eff.rows[0].n, 0); // 失敗事件未留下效果
});

test('P3-08 RBAC 負例：非 Admin 觸發 worker → 403', async () => {
  const r = await api('POST', `/internal/outbox/process`, { roles: 'PM,Lead', body: {} });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
