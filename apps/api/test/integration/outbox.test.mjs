// P3-08 專案健康度 + 交易性 outbox（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb } from './helpers.mjs';

const evalBody = (over = {}) => ({ entity_type: 'task', period: '2027-W02', ...over });

// worker 以多次呼叫持續消費；反覆派工直到清空，結果不受既有積壓（>20 筆）影響。
async function drainOutbox(max = 15) {
  const results = [];
  for (let i = 0; i < max; i++) {
    const r = await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: { limit: 20 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    results.push(...r.body.results);
    if (r.body.claimed === 0) break;
  }
  return results;
}

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
  await drainOutbox();
  const eff = await db().query(`SELECT count(*)::int n FROM event_effects WHERE event_id=$1`, [eventId]);
  assert.equal(eff.rows[0].n, 1);
  const job = await db().query(`SELECT state FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'succeeded');
});

test('P3-08 冪等：同 event_id 重投 → 效果不重複套用', async () => {
  const enq = (await api('POST', `/internal/outbox/enqueue-test`, { roles: 'Admin', body: {} })).body;
  const eventId = enq.event_id;
  await drainOutbox();
  // 模擬重投：worker 於套用效果後、標記完成前崩潰重啟 → 事件再次可派
  await db().query(`UPDATE job_outbox SET state='pending', available_at=now() WHERE event_id=$1`, [eventId]);
  const replay = await drainOutbox();
  const mine = replay.find((x) => x.event_id === eventId);
  assert.ok(mine, '重投事件應於某批次被再次認領');
  assert.equal(mine.applied, false); // 第二次未套用（event_id 已消費）
  const eff = await db().query(`SELECT count(*)::int n FROM event_effects WHERE event_id=$1`, [eventId]);
  assert.equal(eff.rows[0].n, 1); // 仍僅一筆
});

test('P3-08 重試/dead-letter：持續失敗達上限 → state=dead，無效果', async () => {
  const enq = (await api('POST', `/internal/outbox/enqueue-test`, { roles: 'Admin', body: { fail: true } })).body;
  const eventId = enq.event_id;
  // 第 1 次失敗 → failed attempts=1
  await drainOutbox();
  let job = await db().query(`SELECT state, attempts FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'failed');
  assert.equal(job.rows[0].attempts, 1);
  // 模擬退避時間到 → 第 2 次
  await db().query(`UPDATE job_outbox SET available_at=now() WHERE event_id=$1`, [eventId]);
  await drainOutbox();
  job = await db().query(`SELECT state, attempts FROM job_outbox WHERE event_id=$1`, [eventId]);
  assert.equal(job.rows[0].state, 'failed');
  assert.equal(job.rows[0].attempts, 2);
  // 第 3 次 → 達上限 dead
  await db().query(`UPDATE job_outbox SET available_at=now() WHERE event_id=$1`, [eventId]);
  await drainOutbox();
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

test('P3-08 積壓：待處理事件超過單批上限時仍被持續消費（全新 DB 綠燈不替代積壓驗證）', async () => {
  // 入列 25 筆（> 單批上限 20），模擬積壓
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const e = await api('POST', `/internal/outbox/enqueue-test`, { roles: 'Admin', body: {} });
    assert.equal(e.status, 201);
    ids.push(e.body.event_id);
  }
  // 反覆派工直到清空；每批上限 20，後續批次須持續消費剩餘積壓與新事件
  let iterations = 0;
  for (;;) {
    const r = await api('POST', `/internal/outbox/process`, { roles: 'Admin', body: { limit: 20 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(++iterations <= 10, '應在有限批次內清空積壓');
    if (r.body.claimed === 0) break;
  }
  // 我的 25 筆事件各恰被消費一次，且無任何一筆殘留未成功
  const effects = await db().query(`SELECT count(*)::int n FROM event_effects WHERE event_id = ANY($1::uuid[])`, [ids]);
  assert.equal(effects.rows[0].n, 25, '每筆積壓事件恰套用一次效果');
  const unfinished = await db().query(`SELECT count(*)::int n FROM job_outbox WHERE event_id = ANY($1::uuid[]) AND state <> 'succeeded'`, [ids]);
  assert.equal(unfinished.rows[0].n, 0, '積壓事件全部成功，無飢餓殘留');
});

test.after(async () => { await closeDb(); });
