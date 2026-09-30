import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { UserContext } from '../auth/request-context';

// worker 上限與退避（可經環境變數調整；預設 3 次、30s 指數退避）
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 3);
const BACKOFF_BASE_SEC = Number(process.env.OUTBOX_BACKOFF_BASE_SEC ?? 30);

interface JobRow {
  id: string;
  org_id: string;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string | null;
  type: string;
  payload: any;
  attempts: number;
}

type JobResult = {
  id: string;
  event_id: string;
  state: 'succeeded' | 'failed' | 'dead';
  applied?: boolean;
  attempts?: number;
  error?: string;
};

/**
 * 交易性 outbox worker（P3-08）。
 *   - 認領 pending/failed 且到期之工作（FOR UPDATE SKIP LOCKED 串行、可水平擴充）。
 *   - 冪等：以 event_id 去重（outbox_consumed），同事件重投僅套用一次效果。
 *   - 失敗：指數退避重試；達上限進 dead-letter（state='dead' + last_error）。
 */
@Injectable()
export class OutboxService {
  constructor(private readonly db: DatabaseService) {}

  /** 處理一批待派工作；回傳結果摘要（供測試與觀測）。 */
  async process(limit = 20): Promise<{ claimed: number; results: JobResult[] }> {
    const claimed = await this.db.query<JobRow>(
      `UPDATE job_outbox SET state = 'running', locked_at = now()
        WHERE id IN (
          SELECT id FROM job_outbox
           WHERE state IN ('pending', 'failed') AND available_at <= now()
           ORDER BY available_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1)
        RETURNING id, org_id, event_id, aggregate_type, aggregate_id, type, payload, attempts`,
      [limit],
    );
    const results: JobResult[] = [];
    for (const job of claimed) {
      results.push(await this.handleOne(job));
    }
    return { claimed: claimed.length, results };
  }

  private async handleOne(job: JobRow): Promise<JobResult> {
    try {
      const applied = await this.db.transaction(async (client) => {
        // 冪等：以 event_id 去重（同事件重投時此處 0 列 → 不再套用效果）
        const consumed = await client.query(
          `INSERT INTO outbox_consumed (event_id) VALUES ($1)
             ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [job.event_id],
        );
        const firstTime = consumed.rows.length > 0;
        if (firstTime) {
          await this.applyEffect(client, job);
        }
        await client.query(
          `UPDATE job_outbox SET state = 'succeeded', locked_at = null WHERE id = $1`,
          [job.id],
        );
        return firstTime;
      });
      return { id: job.id, event_id: job.event_id, state: 'succeeded', applied };
    } catch (err) {
      return this.onFailure(job, err);
    }
  }

  /**
   * 效果套用（示範性、可觀察）：每事件至多一筆 event_effects。
   * 測試以 payload.fail=true 觸發失敗路徑（退避／dead-letter）。
   */
  private async applyEffect(client: PoolClient, job: JobRow): Promise<void> {
    if (job.payload?.fail === true) {
      throw new Error('模擬事件處理失敗');
    }
    await client.query(
      `INSERT INTO event_effects (org_id, event_id, kind, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING`,
      [job.org_id, job.event_id, job.type, JSON.stringify(job.payload ?? {})],
    );
  }

  private async onFailure(job: JobRow, err: unknown): Promise<JobResult> {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (attempts >= MAX_ATTEMPTS) {
      await this.db.query(
        `UPDATE job_outbox
            SET state = 'dead', attempts = $2, last_error = $3, locked_at = null
          WHERE id = $1`,
        [job.id, attempts, message],
      );
      return { id: job.id, event_id: job.event_id, state: 'dead', attempts, error: message };
    }
    const backoffSec = BACKOFF_BASE_SEC * Math.pow(2, attempts - 1);
    await this.db.query(
      `UPDATE job_outbox
          SET state = 'failed', attempts = $2, last_error = $3, locked_at = null,
              available_at = now() + ($4 || ' seconds')::interval
        WHERE id = $1`,
      [job.id, attempts, message, String(backoffSec)],
    );
    return { id: job.id, event_id: job.event_id, state: 'failed', attempts, error: message };
  }

  /** 測試用：入列一筆事件（fail=true 走失敗路徑）。 */
  async enqueueTest(ctx: UserContext, fail = false): Promise<{ id: string; event_id: string }> {
    const rows = await this.db.query<{ id: string; event_id: string }>(
      `INSERT INTO job_outbox (org_id, aggregate_type, type, payload)
       VALUES ($1, 'test', 'test.effect', $2)
       RETURNING id, event_id`,
      [ctx.orgId, JSON.stringify({ fail })],
    );
    return rows[0];
  }
}
