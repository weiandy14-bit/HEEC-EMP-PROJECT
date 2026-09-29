-- =============================================================================
-- 0006_project_tasks_dependencies.sql — 專案工作、相依關係
-- =============================================================================
-- project_tasks 保存目前計畫（可 UPDATE）；baseline_* 為不可變快照。
-- 所有可排程葉工作須有通向錨點之路（見 D03、§7）。

CREATE TABLE project_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id          uuid NOT NULL,
  parent_task_id      uuid,
  template_task_id    uuid REFERENCES wbs_template_tasks (id) ON DELETE RESTRICT,
  wbs_code            text NOT NULL,
  sort_key            text NOT NULL,
  name                text NOT NULL,
  description         text,
  discipline_id       uuid REFERENCES disciplines (id) ON DELETE RESTRICT,
  type                task_type NOT NULL DEFAULT 'task',
  schedule_mode       schedule_mode NOT NULL DEFAULT 'fixed_duration',
  -- 計畫（排程計算輸出；以 UTC 時間點儲存）
  planned_start       timestamptz,
  planned_finish      timestamptz,
  -- 實績（權限者填；見 §7 進度規則）
  actual_start        timestamptz,
  actual_finish       timestamptz,
  duration_minutes    int NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  display_unit        text NOT NULL DEFAULT 'd',  -- 顯示單位 d/h/m（來源保留）
  percent_complete    numeric(5,2) NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  remaining_minutes   int CHECK (remaining_minutes IS NULL OR remaining_minutes >= 0),
  constraint_type     constraint_type NOT NULL DEFAULT 'ASAP',
  constraint_date     timestamptz,
  milestone           boolean NOT NULL DEFAULT false,
  summary             boolean NOT NULL DEFAULT false,
  critical            boolean NOT NULL DEFAULT false,
  total_float_minutes int,
  free_float_minutes  int,
  status              text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'on_hold')),
  priority            int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  owner_user_id       uuid,
  deliverable_label   text,
  statutory_review_id uuid,       -- 延遲 FK 至 project_statutory_reviews
  locked              boolean NOT NULL DEFAULT false,
  notes               text,
  calendar_id         uuid,
  schedule_version    bigint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  version             bigint NOT NULL DEFAULT 1,
  archived_at         timestamptz,
  CONSTRAINT fk_tasks_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  -- 同案父子（複合 project FK 強制同案）
  CONSTRAINT fk_tasks_parent FOREIGN KEY (project_id, parent_task_id)
    REFERENCES project_tasks (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_tasks_wbs UNIQUE (project_id, wbs_code),
  -- 供 task_dependencies / resource_assignments 之複合 FK 參照
  CONSTRAINT uq_tasks_project_id UNIQUE (project_id, id),
  CONSTRAINT ck_tasks_actual_order
    CHECK (actual_finish IS NULL OR actual_start IS NULL OR actual_finish >= actual_start),
  -- 完成=100 須有完成日期；完成日期須 100%（§7）
  CONSTRAINT ck_tasks_complete
    CHECK ((percent_complete = 100) = (actual_finish IS NOT NULL) OR type IN ('summary'))
);
CREATE INDEX ix_tasks_parent_sort ON project_tasks (project_id, parent_task_id, sort_key);
CREATE INDEX ix_tasks_finish_status ON project_tasks (project_id, planned_finish, status);
CREATE INDEX ix_tasks_owner ON project_tasks (owner_user_id) WHERE owner_user_id IS NOT NULL;
SELECT attach_updated_trigger('project_tasks');

-- 相依關係（含關係型別、lag、lag 日曆政策）
CREATE TABLE task_dependencies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id          uuid NOT NULL,
  predecessor_task_id uuid NOT NULL,
  successor_task_id   uuid NOT NULL,
  relation            dependency_relation NOT NULL DEFAULT 'FS',
  lag_minutes         int NOT NULL DEFAULT 0,     -- 允許負值（D06），上限於應用層檢查
  lag_calendar_policy text NOT NULL DEFAULT 'successor',  -- successor / predecessor / named
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  version             bigint NOT NULL DEFAULT 1,
  archived_at         timestamptz,
  -- 前置與後續皆須同案（複合 project FK）
  CONSTRAINT fk_dep_pred FOREIGN KEY (project_id, predecessor_task_id)
    REFERENCES project_tasks (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dep_succ FOREIGN KEY (project_id, successor_task_id)
    REFERENCES project_tasks (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_dep UNIQUE (predecessor_task_id, successor_task_id, relation),
  CONSTRAINT ck_dep_not_self CHECK (predecessor_task_id <> successor_task_id)
);
CREATE INDEX ix_dep_succ ON task_dependencies (successor_task_id);
CREATE INDEX ix_dep_pred ON task_dependencies (predecessor_task_id);
SELECT attach_updated_trigger('task_dependencies');
