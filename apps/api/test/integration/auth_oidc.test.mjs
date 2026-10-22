// Phase 6 B1 — 身分對應（DB 權威）整合測試（真實 DB）。
// 驗證：已驗證 claims → 以 (issuer,subject) 查 DB；org/roles 讀 DB；
// 未佈建→拒、未啟用→拒；last_login_at 節流與 login_events 稽核。
// 不經 HTTP；直接以 dist 的 IdentityService 搭真實 pg 連線測試對應邏輯。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {db, closeDb, ORG} from './helpers.mjs';
const require = createRequire(import.meta.url);
const {IdentityService} = require('../../dist/auth/identity.service.js');

const ISS = 'https://idp.example';

// 以 pg pool 鴨子型別出 DatabaseService 介面（query / queryOne）。
function dbShim(){
  const pool = db();
  return {
    query: async (t,p=[]) => (await pool.query(t,p)).rows,
    queryOne: async (t,p=[]) => (await pool.query(t,p)).rows[0] ?? null,
  };
}

function claims(subject, extra={}){
  const now = Math.floor(Date.now()/1000);
  return {iss:ISS, sub:subject, aud:'heec-api', iat:now, exp:now+300, email:`${subject}@example.com`, ...extra};
}

async function seedUser({subject, status='active'}){
  const id = randomUUID();
  await db().query(
    `INSERT INTO users (id,org_id,issuer,subject,email,display_name,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, ORG, ISS, subject, `${subject}@example.com`, subject, status],
  );
  return id;
}
async function seedRole(code){
  const id = randomUUID();
  await db().query(
    `INSERT INTO roles (id,org_id,code,name,scope_type) VALUES ($1,$2,$3,$4,'org')`,
    [id, ORG, code, code],
  );
  return id;
}

const created = {users:[], roles:[]};
test.after(async()=>{
  for(const u of created.users){
    await db().query('DELETE FROM login_events WHERE user_id=$1',[u]).catch(()=>{});
    await db().query('DELETE FROM user_roles WHERE user_id=$1',[u]).catch(()=>{});
    await db().query('DELETE FROM users WHERE id=$1',[u]).catch(()=>{});
  }
  for(const r of created.roles){
    await db().query('DELETE FROM user_roles WHERE role_id=$1',[r]).catch(()=>{});
    await db().query('DELETE FROM roles WHERE id=$1',[r]).catch(()=>{});
  }
  await closeDb();
});

test('已佈建使用者：org 與角色皆讀 DB', async()=>{
  process.env.AUTH_CONTEXT_TTL_MS='0'; // 關閉快取，確保讀 DB
  const sub = 'oidc-'+randomUUID();
  const uid = await seedUser({subject:sub}); created.users.push(uid);
  const roleId = await seedRole('PM-'+randomUUID().slice(0,8)); created.roles.push(roleId);
  const code = (await db().query('SELECT code FROM roles WHERE id=$1',[roleId])).rows[0].code;
  await db().query(`INSERT INTO user_roles (org_id,user_id,role_id,scope_type) VALUES ($1,$2,$3,'org')`,[ORG,uid,roleId]);

  const svc = new IdentityService(dbShim());
  const ctx = await svc.resolve(claims(sub));
  assert.equal(ctx.orgId, ORG);
  assert.equal(ctx.userId, uid);
  assert.ok(ctx.roles.includes(code), `roles=${JSON.stringify(ctx.roles)}`);
});

test('未佈建身分被拒（user_not_provisioned）', async()=>{
  const svc = new IdentityService(dbShim());
  await assert.rejects(()=>svc.resolve(claims('ghost-'+randomUUID())), (e)=>e.code==='user_not_provisioned');
});

test('未啟用帳號被拒（user_inactive）', async()=>{
  const sub = 'inactive-'+randomUUID();
  const uid = await seedUser({subject:sub, status:'inactive'}); created.users.push(uid);
  const svc = new IdentityService(dbShim());
  await assert.rejects(()=>svc.resolve(claims(sub)), /未啟用|user_inactive/);
});

test('last_login_at 節流：時間窗內多次 resolve 僅記一筆 login_events', async()=>{
  process.env.AUTH_CONTEXT_TTL_MS='0';            // 每次都打 DB
  process.env.AUTH_SESSION_WINDOW_MS='600000';    // 10 分鐘窗
  const sub = 'session-'+randomUUID();
  const uid = await seedUser({subject:sub}); created.users.push(uid);
  const svc = new IdentityService(dbShim());
  await svc.resolve(claims(sub, {azp:'web-spa', jti:randomUUID()}));
  await svc.resolve(claims(sub, {azp:'web-spa', jti:randomUUID()}));
  await svc.resolve(claims(sub, {azp:'web-spa', jti:randomUUID()}));
  const n = (await db().query('SELECT count(*)::int c FROM login_events WHERE user_id=$1',[uid])).rows[0].c;
  assert.equal(n, 1, '時間窗內應僅記一筆登入事件');
  const last = (await db().query('SELECT last_login_at FROM users WHERE id=$1',[uid])).rows[0].last_login_at;
  assert.ok(last, 'last_login_at 應已更新');
});
