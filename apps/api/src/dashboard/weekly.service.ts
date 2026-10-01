import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { UserContext } from '../auth/request-context';
import type { WeeklyBoardQueryDto } from './dto';

const TZ_MIN = 480;
const DAY_MS = 86_400_000;

/** 本週重要事項（跨案）週邊界（Asia/Taipei 週一 00:00）之 UTC。 */
function weekStartUtcMs(refUtcMs: number): number {
  const wall = new Date(refUtcMs + TZ_MIN * 60000);
  const isoDow = (wall.getUTCDay() + 6) % 7;
  const wallMondayMid = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - isoDow * DAY_MS;
  return wallMondayMid - TZ_MIN * 60000;
}
function isoWeekMondayUtcMs(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dow * DAY_MS + (week - 1) * 7 * DAY_MS - TZ_MIN * 60000;
}

@Injectable()
export class WeeklyBoardService {
  constructor(private readonly db: DatabaseService) {}

  private resolveWeek(week?: string): { startMs: number; endMs: number } {
    let startMs: number;
    const m = week ? /^(\d{4})-W(\d{2})$/.exec(week) : null;
    if (m) startMs = isoWeekMondayUtcMs(Number(m[1]), Number(m[2]));
    else {
      const base = weekStartUtcMs(Date.now());
      startMs = week === 'prev' ? base - 7 * DAY_MS : week === 'next' ? base + 7 * DAY_MS : base;
    }
    return { startMs, endMs: startMs + 7 * DAY_MS };
  }

  private async visibleProjectIds(ctx: UserContext): Promise<string[]> {
    const isAdmin = ctx.roles.includes('Admin');
    const rows = await this.db.query<{ id: string }>(
      `SELECT p.id FROM projects p
        WHERE p.org_id = $1 AND p.archived_at IS NULL
          AND ( $3 OR p.created_by = $2 OR p.pm_user_id = $2
                OR EXISTS (SELECT 1 FROM project_members m
                            WHERE m.project_id = p.id AND m.user_id = $2 AND m.archived_at IS NULL) )`,
      [ctx.orgId, ctx.userId, isAdmin]);
    return rows.map((r) => r.id);
  }

  async board(ctx: UserContext, q: WeeklyBoardQueryDto) {
    const { startMs, endMs } = this.resolveWeek(q.week);
    const start = new Date(startMs).toISOString();
    const end = new Date(endMs).toISOString();
    const ids = await this.visibleProjectIds(ctx);
    if (ids.length === 0) {
      return { weekStart: start, weekEnd: end, items: [] };
    }
    const want = (t: string) => !q.type || q.type === t;
    const items: any[] = [];

    // 交圖（deliverables.due_at）；完成=accepted/locked
    if (want('交圖')) {
      const rows = await this.db.query<any>(
        `SELECT d.id, d.name AS title, d.project_id, p.name AS project_name,
                d.approver_id AS assignee_id, u.display_name AS assignee_name,
                d.due_at, d.status,
                (d.due_at < $3 AND d.status NOT IN ('accepted','locked')) AS overdue
           FROM deliverables d
           JOIN projects p ON p.id = d.project_id
           LEFT JOIN users u ON u.id = d.approver_id
          WHERE d.org_id = $1 AND d.project_id = ANY($2) AND d.archived_at IS NULL
            AND d.due_at IS NOT NULL
            AND ( (d.due_at >= $3 AND d.due_at < $4)
                  OR (d.due_at < $3 AND d.status NOT IN ('accepted','locked')) )
            ${q.assignee ? 'AND d.approver_id = $5' : ''}`,
        q.assignee ? [ctx.orgId, ids, start, end, q.assignee] : [ctx.orgId, ids, start, end]);
      for (const r of rows) items.push(toItem('交圖', 'deliverable', r));
    }

    // 送審/補正（review steps）；補正=status revision；完成=passed/failed
    if (want('送審') || want('補正')) {
      const rows = await this.db.query<any>(
        `SELECT s.id, s.step_code AS title, r.project_id, p.name AS project_name,
                s.owner_id AS assignee_id, u.display_name AS assignee_name,
                COALESCE(s.due_at, s.planned_at) AS due_at, s.status,
                (COALESCE(s.due_at, s.planned_at) < $3 AND s.status NOT IN ('passed','failed')) AS overdue
           FROM project_statutory_review_steps s
           JOIN project_statutory_reviews r ON r.id = s.review_id
           JOIN projects p ON p.id = r.project_id
           LEFT JOIN users u ON u.id = s.owner_id
          WHERE s.org_id = $1 AND r.project_id = ANY($2) AND s.archived_at IS NULL
            AND COALESCE(s.due_at, s.planned_at) IS NOT NULL
            AND ( (COALESCE(s.due_at, s.planned_at) >= $3 AND COALESCE(s.due_at, s.planned_at) < $4)
                  OR (COALESCE(s.due_at, s.planned_at) < $3 AND s.status NOT IN ('passed','failed')) )
            ${q.assignee ? 'AND s.owner_id = $5' : ''}`,
        q.assignee ? [ctx.orgId, ids, start, end, q.assignee] : [ctx.orgId, ids, start, end]);
      for (const r of rows) {
        const t = r.status === 'revision' ? '補正' : '送審';
        if (want(t)) items.push(toItem(t, 'review_step', r));
      }
    }

    // 會議（meetings.starts_at）；完成=held/cancelled
    if (want('會議')) {
      const rows = await this.db.query<any>(
        `SELECT m.id, m.topic AS title, m.project_id, p.name AS project_name,
                m.organizer_id AS assignee_id, u.display_name AS assignee_name,
                m.starts_at AS due_at, m.status,
                (m.starts_at < $3 AND m.status = 'scheduled') AS overdue
           FROM meetings m
           JOIN projects p ON p.id = m.project_id
           LEFT JOIN users u ON u.id = m.organizer_id
          WHERE m.org_id = $1 AND m.project_id = ANY($2) AND m.archived_at IS NULL
            AND m.starts_at IS NOT NULL
            AND ( (m.starts_at >= $3 AND m.starts_at < $4)
                  OR (m.starts_at < $3 AND m.status = 'scheduled') )
            ${q.assignee ? 'AND m.organizer_id = $5' : ''}`,
        q.assignee ? [ctx.orgId, ids, start, end, q.assignee] : [ctx.orgId, ids, start, end]);
      for (const r of rows) items.push(toItem('會議', 'meeting', r));
    }

    // 逾期置頂，其次依到期時間
    items.sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || String(a.due_at).localeCompare(String(b.due_at)));
    return { weekStart: start, weekEnd: end, items };
  }
}

function toItem(type: string, kind: string, r: any) {
  return {
    id: r.id, type, title: r.title,
    project_id: r.project_id, project_name: r.project_name,
    assignee_id: r.assignee_id, assignee_name: r.assignee_name ?? null,
    source: { kind, id: r.id },
    due_at: r.due_at, status: r.status, overdue: !!r.overdue,
  };
}
