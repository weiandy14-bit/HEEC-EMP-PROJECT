-- =============================================================================
-- 0018_dashboard_gantt.sql — 多案總控甘特讀模型（P4-A1）
-- =============================================================================
-- 即時 view（不物化、不快取）：每任務一列，併 active baseline 之起訖，供頁 A 甘特。
-- read-your-writes：view 直讀基表，重新查詢即取得已提交最新資料。

CREATE VIEW v_gantt_task AS
SELECT
  t.org_id,
  t.project_id,
  t.id,
  t.parent_task_id,
  t.wbs_code,
  t.sort_key,
  t.name,
  t.discipline_id,
  t.owner_user_id,
  t.milestone,
  t.summary,
  t.critical,
  t.status,
  t.percent_complete,
  t.planned_start,
  t.planned_finish,
  t.actual_start,
  t.actual_finish,
  bt.start_at   AS baseline_start,
  bt.finish_at  AS baseline_finish
FROM project_tasks t
LEFT JOIN baselines b
  ON b.project_id = t.project_id AND b.status = 'active'
LEFT JOIN baseline_tasks bt
  ON bt.baseline_id = b.id AND bt.task_id = t.id
WHERE t.archived_at IS NULL;

-- 甘特依案彙整、以 sort_key 排序；覆蓋 project_id 篩選與排序。
CREATE INDEX ix_tasks_project_sortkey ON project_tasks (project_id, sort_key)
  WHERE archived_at IS NULL;
