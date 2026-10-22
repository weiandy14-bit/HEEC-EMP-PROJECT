// Phase 6 B4 — 可觀測性整合測試：liveness / readiness / Prometheus metrics。
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE, api} from './helpers.mjs';

test('/health/live 永遠 200', async () => {
  const r = await fetch(BASE + '/health/live');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.status, 'ok');
});

test('/health/ready 回報 DB 與元件狀態（測試環境 scanner=bypassed）', async () => {
  const r = await fetch(BASE + '/health/ready');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ready, true);
  assert.equal(b.checks.db, 'up');
  assert.match(b.checks.scanner, /bypassed/);
  assert.ok(['local', 's3'].includes(b.checks.storage));
});

test('/metrics 以 Prometheus 文字格式輸出並反映請求計數', async () => {
  // 先打幾個請求產生指標
  await api('GET', '/projects');
  await fetch(BASE + '/health/live');
  const r = await fetch(BASE + '/metrics');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/plain/);
  const text = await r.text();
  assert.match(text, /# TYPE http_requests_total counter/);
  assert.match(text, /http_requests_total\{method="GET",status="200"\} \d+/);
  assert.match(text, /# TYPE http_request_duration_seconds histogram/);
  assert.match(text, /http_request_duration_seconds_bucket\{method="GET",le="\+Inf"\} \d+/);
  assert.match(text, /process_uptime_seconds \d/);
  assert.match(text, /app_build_info\{version=".+"\} 1/);
});
