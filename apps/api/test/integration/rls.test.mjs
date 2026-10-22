// Phase 6 B2 — Row-Level Security 整合證明（真實 DB）。
// 以最小權限角色 app_rw（非 superuser、無 BYPASSRLS）驗證組織隔離：
// app.current_org 決定可見列；WITH CHECK 擋跨組織寫入；未設 GUC → 0 列（fail-closed）；
// 並確認 superuser 會繞過 RLS（正式環境故以 app_rw 連線）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db, closeDb, ORG} from './helpers.mjs';

const ORG_A = ORG;                                   // 已 seed 的組織
const ORG_B = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b'; // 測試建立的第二組織
const roleA = randomUUID();
const roleB = randomUUID();

test.before(async () => {
  await db().query(
    `INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
    [ORG_B, 'ORGB-'+ORG_B.slice(0,8), 'RLS 測試組織 B'],
  );
  await db().query(`INSERT INTO roles (id,org_id,code,name,scope_type) VALUES ($1,$2,$3,$4,'org')`,
    [roleA, ORG_A, 'RLS-A-'+roleA.slice(0,6), 'A']);
  await db().query(`INSERT INTO roles (id,org_id,code,name,scope_type) VALUES ($1,$2,$3,$4,'org')`,
    [roleB, ORG_B, 'RLS-B-'+roleB.slice(0,6), 'B']);
});

test.after(async () => {
  await db().query('DELETE FROM roles WHERE id = ANY($1)', [[roleA, roleB]]).catch(()=>{});
  await db().query('DELETE FROM organizations WHERE id=$1', [ORG_B]).catch(()=>{});
  await closeDb();
});

/** 在一個交易中以 app_rw 身分、指定 org 執行 fn（rollback 收尾，不留痕）。 */
async function asAppRw(orgId, fn) {
  const c = await db().connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE app_rw');
    if (orgId !== undefined) await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(()=>{});
    c.release();
  }
}

test('org A 脈絡只看得到 A 的列，看不到 B', async () => {
  await asAppRw(ORG_A, async (c) => {
    const ids = (await c.query('SELECT id FROM roles WHERE id = ANY($1)', [[roleA, roleB]])).rows.map(r=>r.id);
    assert.ok(ids.includes(roleA), 'A 應可見自身列');
    assert.ok(!ids.includes(roleB), 'A 不應看到 B 的列');
  });
});

test('org B 脈絡只看得到 B 的列', async () => {
  await asAppRw(ORG_B, async (c) => {
    const ids = (await c.query('SELECT id FROM roles WHERE id = ANY($1)', [[roleA, roleB]])).rows.map(r=>r.id);
    assert.ok(ids.includes(roleB) && !ids.includes(roleA));
  });
});

test('organizations 亦隔離：A 脈絡看不到 B 組織', async () => {
  await asAppRw(ORG_A, async (c) => {
    const rows = (await c.query('SELECT id FROM organizations WHERE id = ANY($1)', [[ORG_A, ORG_B]])).rows.map(r=>r.id);
    assert.ok(rows.includes(ORG_A) && !rows.includes(ORG_B));
  });
});

test('WITH CHECK 擋跨組織寫入：A 脈絡插入 org=B 的列被拒', async () => {
  await asAppRw(ORG_A, async (c) => {
    await assert.rejects(
      () => c.query(`INSERT INTO roles (id,org_id,code,name,scope_type) VALUES ($1,$2,$3,'x','org')`,
        [randomUUID(), ORG_B, 'HACK-'+randomUUID().slice(0,6)]),
      /row-level security|policy/i,
    );
  });
});

test('跨組織 UPDATE 影響 0 列（他組織列不可見）', async () => {
  await asAppRw(ORG_A, async (c) => {
    const res = await c.query('UPDATE roles SET name=$2 WHERE id=$1', [roleB, 'tampered']);
    assert.equal(res.rowCount, 0);
  });
  // 確認 B 的列未被更動
  const name = (await db().query('SELECT name FROM roles WHERE id=$1', [roleB])).rows[0].name;
  assert.equal(name, 'B');
});

test('未設 app.current_org → 0 列（fail-closed）', async () => {
  await asAppRw(undefined, async (c) => {
    const n = (await c.query('SELECT count(*)::int c FROM roles WHERE id = ANY($1)', [[roleA, roleB]])).rows[0].c;
    assert.equal(n, 0);
  });
});

test('superuser 會繞過 RLS（故正式環境以 app_rw 連線）', async () => {
  // 不 SET ROLE：以 superuser 連線，應同時看到 A 與 B。
  const ids = (await db().query('SELECT id FROM roles WHERE id = ANY($1)', [[roleA, roleB]])).rows.map(r=>r.id);
  assert.ok(ids.includes(roleA) && ids.includes(roleB));
});
