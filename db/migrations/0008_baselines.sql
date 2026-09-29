-- =============================================================================
-- 0008_baselines.sql — 基準（不可變快照）
-- =============================================================================
-- 單一 active；建立新 active 與舊版 supersede 同交易；快照永不 UPDATE（§7）。

CREATE TABLE baselines (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id                  uuid NOT NULL,
  sequence_no                 int NOT NULL,
  label                       text,
  created_from_schedule_version bigint NOT NULL,
  status                      text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded')),
  snapshot_hash               text,
  captured_at                 timestamptz NOT NULL DEFAULT now(),
  captured_by                 uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid,
  updated_by                  uuid,
  version                     bigint NOT NULL DEFAULT 1,
  archived_at                 timestamptz,
  CONSTRAINT fk_baselines_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_baselines_seq UNIQUE (project_id, sequence_no),
  CONSTRAINT uq_baselines_id UNIQUE (id)
);
-- 每案至多一個 active baseline
CREATE UNIQUE INDEX uq_baselines_active
  ON baselines (project_id) WHERE status = 'active';
SELECT attach_updated_trigger('baselines');

-- 基準工作快照（不可變）
CREATE TABLE baseline_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id         uuid NOT NULL REFERENCES baselines (id) ON DELETE RESTRICT,
  task_id             uuid NOT NULL,   -- 參考當時 project_tasks.id（非 FK：任務可能刪除）
  start_at            timestamptz,
  finish_at           timestamptz,
  duration_minutes    int NOT NULL DEFAULT 0,
  work_minutes        int NOT NULL DEFAULT 0,
  cost                numeric(14,4),
  assignments_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,  -- 見 baseline_assignments 正規化版
  task_name           text NOT NULL,
  wbs_code            text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_baseline_task UNIQUE (baseline_id, task_id)
);
CREATE INDEX ix_baseline_tasks_baseline ON baseline_tasks (baseline_id);

-- 基準指派快照（正規化、不可變；取代單靠 JSON，見 §4 補充）
CREATE TABLE baseline_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id  uuid NOT NULL REFERENCES baselines (id) ON DELETE RESTRICT,
  task_id      uuid NOT NULL,
  resource_id  uuid NOT NULL,
  work_minutes int NOT NULL DEFAULT 0,
  units        numeric(6,4) NOT NULL DEFAULT 1.0,
  start_at     timestamptz,
  finish_at    timestamptz,
  cost         numeric(14,4),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_baseline_assignment UNIQUE (baseline_id, task_id, resource_id)
);
CREATE INDEX ix_baseline_assign_baseline ON baseline_assignments (baseline_id);
