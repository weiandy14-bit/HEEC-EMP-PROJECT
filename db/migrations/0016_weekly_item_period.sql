-- =============================================================================
-- 0016_weekly_item_period.sql — 週工作項工作期間（P3-06 跨週顯示）
-- =============================================================================
-- 跨週顯示條件＝「工作期間與查詢週相交」或「逾期且未完成」；
-- source_key 僅負責資料去重，不決定顯示於哪一週。故新增期間欄位。

ALTER TABLE weekly_items ADD COLUMN period_start timestamptz;
ALTER TABLE weekly_items ADD COLUMN period_end   timestamptz;

CREATE INDEX ix_weekly_period ON weekly_items (project_id, period_start, period_end);

COMMENT ON COLUMN weekly_items.period_start IS '工作期間起（缺則以 due_at 當點）';
COMMENT ON COLUMN weekly_items.period_end IS '工作期間迄（缺則以 due_at 當點）';
