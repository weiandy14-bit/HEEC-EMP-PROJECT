/**
 * 依賴最少的 Prometheus 指標登錄（無第三方 client）。
 * - http_requests_total{method,status}：請求計數
 * - http_request_duration_seconds{method}：延遲直方圖（累積 bucket + _sum + _count）
 * - process_uptime_seconds / nodejs_memory_rss_bytes：程序概況
 * - app_build_info{version}：建置資訊
 * 標籤刻意收斂（method 與 status code），避免高基數爆量。
 */

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Metrics {
  private readonly startedAt = Date.now();
  private readonly reqTotal = new Map<string, number>(); // `${method}|${status}` → count
  private readonly durCount = new Map<string, number>(); // method → count
  private readonly durSum = new Map<string, number>(); // method → seconds
  private readonly durBuckets = new Map<string, number[]>(); // method → cumulative-ready counts per bucket

  observeRequest(method: string, status: number, durationMs: number): void {
    const m = method.toUpperCase();
    const k = `${m}|${status}`;
    this.reqTotal.set(k, (this.reqTotal.get(k) ?? 0) + 1);
    const secs = durationMs / 1000;
    this.durCount.set(m, (this.durCount.get(m) ?? 0) + 1);
    this.durSum.set(m, (this.durSum.get(m) ?? 0) + secs);
    let buckets = this.durBuckets.get(m);
    if (!buckets) {
      buckets = new Array(DURATION_BUCKETS.length).fill(0);
      this.durBuckets.set(m, buckets);
    }
    for (let i = 0; i < DURATION_BUCKETS.length; i++) if (secs <= DURATION_BUCKETS[i]) buckets[i]++;
  }

  render(): string {
    const lines: string[] = [];
    lines.push('# HELP http_requests_total Total HTTP requests by method and status.');
    lines.push('# TYPE http_requests_total counter');
    for (const [k, v] of this.reqTotal) {
      const [method, status] = k.split('|');
      lines.push(`http_requests_total{method="${method}",status="${status}"} ${v}`);
    }
    lines.push('# HELP http_request_duration_seconds Request latency in seconds.');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [method, buckets] of this.durBuckets) {
      let cumulative = 0;
      for (let i = 0; i < DURATION_BUCKETS.length; i++) {
        cumulative = buckets[i]; // buckets already counted as <= le (cumulative by construction)
        lines.push(`http_request_duration_seconds_bucket{method="${method}",le="${DURATION_BUCKETS[i]}"} ${cumulative}`);
      }
      const count = this.durCount.get(method) ?? 0;
      lines.push(`http_request_duration_seconds_bucket{method="${method}",le="+Inf"} ${count}`);
      lines.push(`http_request_duration_seconds_sum{method="${method}"} ${(this.durSum.get(method) ?? 0).toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count{method="${method}"} ${count}`);
    }
    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(3)}`);
    lines.push('# HELP nodejs_memory_rss_bytes Resident set size in bytes.');
    lines.push('# TYPE nodejs_memory_rss_bytes gauge');
    lines.push(`nodejs_memory_rss_bytes ${process.memoryUsage().rss}`);
    lines.push('# HELP app_build_info Build information.');
    lines.push('# TYPE app_build_info gauge');
    lines.push(`app_build_info{version="${(process.env.APP_VERSION ?? 'dev').replace(/"/g, '')}"} 1`);
    return lines.join('\n') + '\n';
  }
}

export const metrics = new Metrics();
