import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import type { UserContext } from '../auth/request-context';
import type { EvaluateAlertDto } from './dto';

type Severity = 'normal' | 'attention' | 'behind' | 'overdue';

@Injectable()
export class AlertsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async assertProject(ctx: UserContext, projectId: string): Promise<void> {
    const p = await this.db.queryOne(
      `SELECT 1 FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.orgId, projectId],
    );
    if (!p) throw DomainError.notFound('專案');
  }

  /**
   * 分級（P3-07）：
   *   已逾計畫完成且未完成 → overdue（優先）
   *   相對 Baseline 落後 ≥4 工作日 → behind
   *   落後 1–3 工作日 → attention
   *   其餘 → normal
   * 逾期與落後同時成立時取 overdue。
   */
  static classify(lateWorkingDays: number, overdue: boolean): Severity {
    if (overdue) return 'overdue';
    if (lateWorkingDays >= 4) return 'behind';
    if (lateWorkingDays >= 1) return 'attention';
    return 'normal';
  }

  async list(ctx: UserContext, projectId: string) {
    await this.assertProject(ctx, projectId);
    return this.db.query(
      `SELECT id, project_id, rule_id, entity_type, entity_id, severity, fingerprint,
              state, assignee_id, snooze_until, reason, occurrence_count,
              first_seen_at, last_seen_at, version
         FROM alerts
        WHERE org_id = $1 AND project_id = $2
        ORDER BY last_seen_at DESC`,
      [ctx.orgId, projectId],
    );
  }

  /** 評估並以指紋去重 upsert（同指紋更新 occurrence/last_seen，不重建）。 */
  async evaluate(ctx: UserContext, projectId: string, dto: EvaluateAlertDto) {
    await this.assertProject(ctx, projectId);
    const ruleCode = dto.rule_code ?? 'SCHEDULE_SLIP';
    const rule = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM alert_rules WHERE org_id = $1 AND code = $2 AND enabled = true`,
      [ctx.orgId, ruleCode],
    );
    if (!rule) throw DomainError.validation('警示規則不存在或停用', { rule_code: ['not found'] });

    const severity = AlertsService.classify(dto.late_working_days ?? 0, dto.overdue ?? false);
    // 指紋含 project 以避免跨案（同組織）同參數碰撞：rule+project+entity+baseline+period
    const fingerprint = `${ruleCode}:${projectId}:${dto.entity_type}:${dto.entity_id ?? '-'}:${dto.baseline_id ?? '-'}:${dto.period}`;
    const evidence = {
      rule_version: 1,
      late_working_days: dto.late_working_days ?? 0,
      overdue: dto.overdue ?? false,
      period: dto.period,
    };

    return this.db.transaction(async (client) => {
      const existing = await client.query<{ id: string; occurrence_count: number }>(
        `SELECT id, occurrence_count FROM alerts
          WHERE org_id = $1 AND fingerprint = $2 AND state <> 'closed'
          FOR UPDATE`,
        [ctx.orgId, fingerprint],
      );
      let row: any;
      let action: string;
      if (existing.rows.length > 0) {
        const res = await client.query(
          `UPDATE alerts
              SET occurrence_count = occurrence_count + 1, last_seen_at = now(),
                  severity = $3, evidence = $4, updated_by = $5
            WHERE org_id = $1 AND id = $2
            RETURNING *`,
          [ctx.orgId, existing.rows[0].id, severity, JSON.stringify(evidence), ctx.userId],
        );
        row = res.rows[0];
        action = 'update_occurrence';
      } else {
        const res = await client.query(
          `INSERT INTO alerts
             (org_id, project_id, rule_id, entity_type, entity_id, severity, fingerprint,
              state, occurrence_count, evidence, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'open',1,$8,$9,$9)
           RETURNING *`,
          [ctx.orgId, projectId, rule.id, dto.entity_type, dto.entity_id ?? null, severity, fingerprint, JSON.stringify(evidence), ctx.userId],
        );
        row = res.rows[0];
        action = 'raise';
      }
      await this.audit.write(client, ctx, {
        entityType: 'alert', entityId: row.id, action,
        diff: { severity, fingerprint, occurrence_count: row.occurrence_count },
      });
      return row;
    });
  }

  private async transition(
    ctx: UserContext, projectId: string, alertId: string,
    state: string, action: string, fields: Record<string, unknown>,
  ) {
    await this.assertProject(ctx, projectId);
    const existing = await this.db.queryOne<{ id: string; state: string }>(
      `SELECT id, state FROM alerts WHERE org_id = $1 AND project_id = $2 AND id = $3`,
      [ctx.orgId, projectId, alertId],
    );
    if (!existing) throw DomainError.notFound('警示');
    return this.db.transaction(async (client) => {
      const res = await client.query(
        `UPDATE alerts
            SET state = $4, reason = COALESCE($5, reason), snooze_until = $6,
                assignee_id = COALESCE($7, assignee_id), updated_by = $8
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          RETURNING *`,
        [ctx.orgId, projectId, alertId, state, fields.reason ?? null, fields.snooze_until ?? null, fields.assignee_id ?? null, ctx.userId],
      );
      await this.audit.write(client, ctx, {
        entityType: 'alert', entityId: alertId, action,
        diff: { from: existing.state, to: state, reason: fields.reason ?? null, snooze_until: fields.snooze_until ?? null },
      });
      return res.rows[0];
    });
  }

  ack(ctx: UserContext, projectId: string, alertId: string, reason: string) {
    return this.transition(ctx, projectId, alertId, 'ack', 'ack', { reason });
  }
  snooze(ctx: UserContext, projectId: string, alertId: string, reason: string, until: string) {
    return this.transition(ctx, projectId, alertId, 'snoozed', 'snooze', { reason, snooze_until: until });
  }
  close(ctx: UserContext, projectId: string, alertId: string, reason: string) {
    return this.transition(ctx, projectId, alertId, 'closed', 'close', { reason });
  }
  assign(ctx: UserContext, projectId: string, alertId: string, assigneeId: string) {
    // assign 不改變 state
    return this.assignInternal(ctx, projectId, alertId, assigneeId);
  }
  private async assignInternal(ctx: UserContext, projectId: string, alertId: string, assigneeId: string) {
    await this.assertProject(ctx, projectId);
    const existing = await this.db.queryOne<{ id: string; state: string }>(
      `SELECT id, state FROM alerts WHERE org_id = $1 AND project_id = $2 AND id = $3`,
      [ctx.orgId, projectId, alertId],
    );
    if (!existing) throw DomainError.notFound('警示');
    return this.db.transaction(async (client) => {
      const res = await client.query(
        `UPDATE alerts SET assignee_id = $4, updated_by = $5
          WHERE org_id = $1 AND project_id = $2 AND id = $3 RETURNING *`,
        [ctx.orgId, projectId, alertId, assigneeId, ctx.userId],
      );
      await this.audit.write(client, ctx, {
        entityType: 'alert', entityId: alertId, action: 'assign', diff: { assignee_id: assigneeId },
      });
      return res.rows[0];
    });
  }
}
