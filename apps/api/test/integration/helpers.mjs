// 整合測試輔助（ESM）：對執行中之 API 發 HTTP，並可直連 DB 驗證稽核。
// 需求：API 執行於 BASE；DB 已套 migrations 與 seed_dev.sql；DATABASE_URL 可連。
import pg from 'pg';

export const BASE = process.env.BASE || 'http://localhost:3000/api/v1';
export const ORG = '11111111-1111-1111-1111-111111111111';
export const PM_USER = '22222222-2222-4222-8222-222222222222';
export const CAL = '33333333-3333-4333-8333-333333333333';
export const FIRE_TEMPLATE = '44444444-4444-4444-8444-444444444444';

export function headers(roles = 'PM,Lead', user = PM_USER) {
  return {
    'X-Org-Id': ORG,
    'X-User-Id': user,
    'X-Roles': roles,
    'Content-Type': 'application/json',
  };
}

export async function api(method, path, { body, roles, user } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(roles, user),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

export async function createProject(overrides = {}) {
  const code = overrides.code || `P3-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const r = await api('POST', '/projects', {
    body: { code, name: 'P3 整合測試', permit_filing_date: '2027-01-11', default_calendar_id: CAL, ...overrides },
  });
  if (r.status >= 300) throw new Error('createProject 失敗: ' + JSON.stringify(r.body));
  return r.body.id;
}

let pool;
export function db() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}
export async function closeDb() {
  if (pool) { await pool.end(); pool = undefined; }
}
