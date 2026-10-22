// Phase 6 B7 — 執行期 RLS 強制整合測試（真實 DB）。
// 證明 DatabaseService 在 RLS_ENFORCE=1 且以 app_rw 連線時，query/transaction 會依
// 請求範圍 org 脈絡（orgContext）對每次存取設定 app.current_org，故只讀寫該組織的列；
// 無脈絡時 fail-closed（0 列）。直接驅動產線程式路徑（scoped/transaction/currentOrgId）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {db, closeDb, ORG} from './helpers.mjs';
const require = createRequire(import.meta.url);
const {DatabaseService} = require('../../dist/database/database.service.js');
const {orgContext} = require('../../dist/common/org-context.js');

const ORG_A = ORG;
const ORG_B = '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';
const roleA = randomUUID();
const roleB = randomUUID();
const PW = 'rls_rt_pw';

let svc;
let prevUrl, prevEnforce;

test.before(async () => {
  // 以 superuser 準備 app_rw 可登入並 seed 兩組織的列（superuser 繞過 RLS）。
  await db().query(`ALTER ROLE app_rw LOGIN PASSWORD '${PW}'`);
  await db().query(`INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [ORG_B, 'RTB-'+ORG_B.slice(0,8), '執行期 RLS 測試 B']);
  await db().query(`INSERT INTO roles (id,org_id,code,name,scope_type) VALUES ($1,$2,$3,'A','org')`, [roleA, ORG_A, 'RT-A-'+roleA.slice(0,6)]);
  await db().query(`INSERT INTO roles (id,org_id,code,name,scope_type) VALUES ($1,$2,$3,'B','org')`, [roleB, ORG_B, 'RT-B-'+roleB.slice(0,6)]);

  // 建一個以 app_rw 連線、開啟 RLS_ENFORCE 的 DatabaseService 實例。
  const appRwUrl = process.env.DATABASE_URL.replace(/:\/\/[^/@]*@/, `://app_rw:${PW}@`);
  prevUrl = process.env.DATABASE_URL; prevEnforce = process.env.RLS_ENFORCE;
  process.env.DATABASE_URL = appRwUrl;
  process.env.RLS_ENFORCE = '1';
  svc = new DatabaseService();
  svc.onModuleInit();
  // 立即還原共用環境變數，避免影響其他測試檔的連線池。
  process.env.DATABASE_URL = prevUrl;
});

test.after(async () => {
  if (svc) await svc.onModuleDestroy();
  if (prevEnforce === undefined) delete process.env.RLS_ENFORCE; else process.env.RLS_ENFORCE = prevEnforce;
  await db().query('DELETE FROM roles WHERE id = ANY($1)', [[roleA, roleB]]).catch(()=>{});
  await db().query('DELETE FROM organizations WHERE id=$1', [ORG_B]).catch(()=>{});
  await closeDb();
});

const bothIds = [[roleA, roleB]];

test('query 於 org A 脈絡只讀到 A 的列', async () => {
  await orgContext.run({orgId: ORG_A}, async () => {
    const ids = (await svc.query('SELECT id FROM roles WHERE id = ANY($1)', bothIds)).map(r => r.id);
    assert.ok(ids.includes(roleA) && !ids.includes(roleB), `ids=${JSON.stringify(ids)}`);
  });
});

test('query 於 org B 脈絡只讀到 B 的列', async () => {
  await orgContext.run({orgId: ORG_B}, async () => {
    const ids = (await svc.query('SELECT id FROM roles WHERE id = ANY($1)', bothIds)).map(r => r.id);
    assert.ok(ids.includes(roleB) && !ids.includes(roleA));
  });
});

test('無 org 脈絡 → fail-closed（0 列）', async () => {
  const ids = (await svc.query('SELECT id FROM roles WHERE id = ANY($1)', bothIds)).map(r => r.id);
  assert.equal(ids.length, 0);
});

test('transaction 於 org A 脈絡：跨組織 UPDATE 影響 0 列', async () => {
  await orgContext.run({orgId: ORG_A}, async () => {
    const n = await svc.transaction(async (c) => (await c.query('UPDATE roles SET name=$2 WHERE id=$1', [roleB, 'x'])).rowCount);
    assert.equal(n, 0);
  });
  const name = (await db().query('SELECT name FROM roles WHERE id=$1', [roleB])).rows[0].name;
  assert.equal(name, 'B');
});

test('並行 query（Promise.all）於同一 org 脈絡皆正確（各自獨立 client）', async () => {
  await orgContext.run({orgId: ORG_A}, async () => {
    const [a, b, c] = await Promise.all([
      svc.query('SELECT id FROM roles WHERE id=$1', [roleA]),
      svc.query('SELECT id FROM roles WHERE id=$1', [roleB]),
      svc.query('SELECT count(*)::int n FROM roles WHERE id = ANY($1)', bothIds),
    ]);
    assert.equal(a.length, 1);     // A 可見
    assert.equal(b.length, 0);     // B 不可見
    assert.equal(c[0].n, 1);       // 總數只算 A
  });
});
