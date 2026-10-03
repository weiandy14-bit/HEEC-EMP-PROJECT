-- =============================================================================
-- 0015_baseline_immutability.sql — 基準快照不可變（G9）
-- =============================================================================
-- 規格 §4/§7：baseline_* 永不 UPDATE（不可變快照）。以觸發器封鎖 UPDATE/DELETE，
-- 僅允許 INSERT（建立快照）。基準之作廢以 baselines.status='superseded' 表示，
-- 不修改既有 baseline_tasks/baseline_assignments 明細。

CREATE OR REPLACE FUNCTION reject_baseline_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'baseline snapshot is immutable: % on % not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_baseline_tasks_immutable
  BEFORE UPDATE OR DELETE ON baseline_tasks
  FOR EACH ROW EXECUTE FUNCTION reject_baseline_mutation();

CREATE TRIGGER trg_baseline_assignments_immutable
  BEFORE UPDATE OR DELETE ON baseline_assignments
  FOR EACH ROW EXECUTE FUNCTION reject_baseline_mutation();

COMMENT ON FUNCTION reject_baseline_mutation() IS '封鎖 baseline_* 明細之 UPDATE/DELETE，確保快照不可變（G9）';
