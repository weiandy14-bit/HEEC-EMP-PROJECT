// P3-05 會議與紀錄（整合測試，真實 DB）
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createProject, db, closeDb, ORG } from './helpers.mjs';
import { randomUUID } from 'node:crypto';

test('P3-05 正例：建立會議、掛紀錄附件、標記 held', async () => {
  const p = await createProject();
  const c = await api('POST', `/projects/${p}/meetings`, {
    body: { starts_at: '2027-01-10T09:00:00+08:00', ends_at: '2027-01-10T10:00:00+08:00', topic: '啟動會議' },
  });
  assert.equal(c.status, 201);
  assert.equal(c.body.status, 'scheduled');
  const id = c.body.id;

  // 直接於 DB 建立一筆附件（尚無 attachments API），供紀錄關聯
  const attId = randomUUID();
  await db().query(
    `INSERT INTO attachments (id, org_id, project_id, entity_type, entity_id, object_key, filename, created_by, updated_by)
     VALUES ($1,$2,$3,'meeting',$4,$5,'minutes.pdf',$6,$6)`,
    [attId, ORG, p, id, 'obj/' + attId, '22222222-2222-4222-8222-222222222222'],
  );

  const r = await api('PATCH', `/projects/${p}/meetings/${id}`, {
    body: { status: 'held', minutes_attachment_id: attId },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'held');
  assert.equal(r.body.minutes_attachment_id, attId);
});

test('P3-05 負例：ends_at 早於 starts_at → 422', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/meetings`, {
    body: { starts_at: '2027-01-10T10:00:00+08:00', ends_at: '2027-01-10T09:00:00+08:00', topic: '錯誤時間' },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.category, 'validation');
});

test('P3-05 負例：不存在之紀錄附件 → 422', async () => {
  const p = await createProject();
  const id = (await api('POST', `/projects/${p}/meetings`, {
    body: { starts_at: '2027-01-10T09:00:00+08:00', topic: 'x' },
  })).body.id;
  const r = await api('PATCH', `/projects/${p}/meetings/${id}`, {
    body: { minutes_attachment_id: randomUUID() },
  });
  assert.equal(r.status, 422);
});

test('P3-05 RBAC 負例：Viewer 建立會議 → 403', async () => {
  const p = await createProject();
  const r = await api('POST', `/projects/${p}/meetings`, {
    roles: 'Viewer', body: { starts_at: '2027-01-10T09:00:00+08:00', topic: 'x' },
  });
  assert.equal(r.status, 403);
});

test.after(async () => { await closeDb(); });
