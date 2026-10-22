// Phase 6 — concurrent load harness (dependency-free). Fires LOAD_VUS virtual
// users against representative read endpoints for LOAD_DURATION_S seconds and
// reports throughput, latency percentiles and error rate.
//
//   BASE=http://localhost:3000/api/v1 LOAD_VUS=300 LOAD_DURATION_S=30 \
//     node scripts/performance/load.mjs
//
// The 300-concurrent-user Phase 6 target must be run against a near-production
// deployment (managed PostgreSQL + real infra); run here at smaller scale to
// validate the harness. Uses the development identity headers (test/dev only).
import {mkdir, writeFile} from 'node:fs/promises';
import {cpus, totalmem, platform} from 'node:os';

const BASE = process.env.BASE ?? 'http://localhost:3000/api/v1';
const VUS = Number(process.env.LOAD_VUS ?? 50);
const DURATION_S = Number(process.env.LOAD_DURATION_S ?? 10);
const ORG = process.env.LOAD_ORG ?? '11111111-1111-1111-1111-111111111111';
const USER = process.env.LOAD_USER ?? '22222222-2222-4222-8222-222222222222';
const headers = {'X-Org-Id': ORG, 'X-User-Id': USER, 'X-Roles': 'PM,Lead'};

// Representative GET endpoints (option/list reads that need no body).
const ENDPOINTS = [
  '/projects',
  '/dashboard/gantt/options',
  '/dashboard/workload/options',
  '/health/ready',
];

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;

async function worker(deadline, stats, idxRef) {
  while (performance.now() < deadline) {
    const path = ENDPOINTS[idxRef.i++ % ENDPOINTS.length];
    const t0 = performance.now();
    try {
      const res = await fetch(BASE + path, {headers});
      await res.arrayBuffer(); // drain body
      const dt = performance.now() - t0;
      stats.latencies.push(dt);
      stats.total++;
      if (!res.ok) { stats.errors++; stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1; }
      else stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1;
    } catch {
      stats.total++; stats.errors++; stats.byStatus['network'] = (stats.byStatus['network'] ?? 0) + 1;
    }
  }
}

async function main() {
  // Warm up / fail fast if the API is unreachable.
  const warm = await fetch(BASE + '/health/live').catch(() => null);
  if (!warm || !warm.ok) { console.error(`API not reachable at ${BASE}`); process.exit(1); }

  const stats = {total: 0, errors: 0, latencies: [], byStatus: {}};
  const idxRef = {i: 0};
  const started = performance.now();
  const deadline = started + DURATION_S * 1000;
  await Promise.all(Array.from({length: VUS}, () => worker(deadline, stats, idxRef)));
  const elapsedS = (performance.now() - started) / 1000;

  const sorted = stats.latencies.slice().sort((a, b) => a - b);
  const report = {
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    hardware: {platform: platform(), cpu: cpus()[0]?.model, vcpus: cpus().length, total_memory_bytes: totalmem()},
    config: {base: BASE, vus: VUS, duration_s: DURATION_S, endpoints: ENDPOINTS},
    results: {
      requests: stats.total,
      elapsed_s: Number(elapsedS.toFixed(2)),
      throughput_rps: Number((stats.total / elapsedS).toFixed(1)),
      errors: stats.errors,
      error_rate: stats.total ? Number((stats.errors / stats.total).toFixed(4)) : 0,
      latency_ms: {
        p50: Number(pct(sorted, 0.50).toFixed(2)),
        p95: Number(pct(sorted, 0.95).toFixed(2)),
        p99: Number(pct(sorted, 0.99).toFixed(2)),
        max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
      },
      by_status: stats.byStatus,
    },
  };

  const out = 'performance-results';
  await mkdir(out, {recursive: true});
  await writeFile(`${out}/load.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.results, null, 2));

  // Guard thresholds (overridable); default lenient so the harness smoke passes.
  const maxErrRate = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.01);
  const maxP95 = Number(process.env.LOAD_MAX_P95_MS ?? 3000);
  if (report.results.error_rate > maxErrRate) { console.error(`FAIL error_rate ${report.results.error_rate} > ${maxErrRate}`); process.exit(1); }
  if (report.results.latency_ms.p95 > maxP95) { console.error(`FAIL p95 ${report.results.latency_ms.p95}ms > ${maxP95}ms`); process.exit(1); }
  console.log(`LOAD OK: ${report.results.throughput_rps} rps, p95 ${report.results.latency_ms.p95}ms, err ${report.results.error_rate}`);
}

main();
