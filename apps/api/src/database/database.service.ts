import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// DATE(oid 1082) 以原字串回傳（避免時區位移），保持 'YYYY-MM-DD' 語義。
types.setTypeParser(1082, (v) => v);

/** PostgreSQL 連線池與交易輔助。 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  onModuleInit(): void {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query<T>(text, params as any[]);
    return res.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * 於單一交易內執行；自動 commit/rollback。
   * 傳入 orgId 時，於交易內設定 app.current_org（SET LOCAL），使 row-level
   * security 政策生效——正式環境以最小權限角色 app_rw 連線時，此 GUC 決定可見列
   * （見 migration 0023）。GUC 為交易區域變數，交易結束即還原，不會外洩至連線池。
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>, opts?: { orgId?: string }): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (opts?.orgId) {
        await client.query("SELECT set_config('app.current_org', $1, true)", [opts.orgId]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** 以指定組織的 RLS 脈絡執行一段交易工作。 */
  withOrg<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(fn, { orgId });
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
