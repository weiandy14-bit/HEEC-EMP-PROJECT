-- =============================================================================
-- 0007_resources_assignments.sql — 資源、資源日曆、資源別名、指派
-- =============================================================================
-- Work 為估計工時，Units 為同時投入比例；兩者獨立保存（D16、§7 負荷）。

CREATE TABLE resources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id         uuid,             -- 可空（非帳號資源，如外包）
  code            text NOT NULL,
  name            text NOT NULL,
  type            text NOT NULL DEFAULT 'labor'
    CHECK (type IN ('labor', 'equipment', 'material', 'cost')),
  max_units       numeric(6,4) NOT NULL DEFAULT 1.0 CHECK (max_units >= 0),  -- 1.0=100%
  base_week_minutes int,            -- 參考用；容量以日曆逐日求和為準（§7）
  team_id         uuid,
  active_from     date,
  active_to       date,
  alias_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_rate       numeric(14,4),    -- 可空、權限受控（D13）
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  version         bigint NOT NULL DEFAULT 1,
  archived_at     timestamptz,
  CONSTRAINT uq_resources_code UNIQUE (org_id, code),
  CONSTRAINT fk_resources_user FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_resources_team FOREIGN KEY (org_id, team_id)
    REFERENCES teams (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_resources_org_id UNIQUE (org_id, id)
);
CREATE INDEX ix_resources_team_active ON resources (team_id, active_from);
SELECT attach_updated_trigger('resources');

-- 資源日曆（個人日曆用於容量，不自動改任務工期，除非 resource-driven）
CREATE TABLE resource_calendars (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  resource_id    uuid NOT NULL,
  calendar_id    uuid NOT NULL,
  effective_from date,
  effective_to   date,
  priority       int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_by     uuid,
  version        bigint NOT NULL DEFAULT 1,
  archived_at    timestamptz,
  CONSTRAINT fk_rescal_resource FOREIGN KEY (org_id, resource_id)
    REFERENCES resources (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescal_calendar FOREIGN KEY (org_id, calendar_id)
    REFERENCES calendars (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_rescal UNIQUE (resource_id, calendar_id, effective_from)
);
SELECT attach_updated_trigger('resource_calendars');

-- 資源別名（匯入時名稱對照；受控 alias）
CREATE TABLE resource_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL,
  alias       text NOT NULL,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     bigint NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CONSTRAINT fk_resalias_resource FOREIGN KEY (org_id, resource_id)
    REFERENCES resources (org_id, id) ON DELETE RESTRICT
);
-- 別名於組織內唯一（不分大小寫）；表達式唯一以索引實作
CREATE UNIQUE INDEX uq_resalias ON resource_aliases (org_id, lower(alias));
SELECT attach_updated_trigger('resource_aliases');

-- 指派（Work / Units 獨立；contour 可選；代班另建 assignment 不覆蓋歷史）
CREATE TABLE resource_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id            uuid NOT NULL,
  task_id               uuid NOT NULL,
  resource_id           uuid NOT NULL,
  assignment_units      numeric(6,4) NOT NULL DEFAULT 1.0 CHECK (assignment_units >= 0),
  planned_work_minutes  int NOT NULL DEFAULT 0 CHECK (planned_work_minutes >= 0),
  actual_work_minutes   int NOT NULL DEFAULT 0 CHECK (actual_work_minutes >= 0),
  remaining_work_minutes int CHECK (remaining_work_minutes IS NULL OR remaining_work_minutes >= 0),
  assignment_start      timestamptz,
  assignment_finish     timestamptz,
  booking_type          text NOT NULL DEFAULT 'committed'
    CHECK (booking_type IN ('committed', 'proposed', 'cover')),  -- cover=代班
  contour               jsonb,     -- 逐期 work 分配曲線（可空=平均攤配）
  cost                  numeric(14,4),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  version               bigint NOT NULL DEFAULT 1,
  archived_at           timestamptz,
  CONSTRAINT fk_assign_task FOREIGN KEY (project_id, task_id)
    REFERENCES project_tasks (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_assign_resource FOREIGN KEY (org_id, resource_id)
    REFERENCES resources (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_assign UNIQUE (task_id, resource_id, booking_type, assignment_start)
);
CREATE INDEX ix_assign_resource_window
  ON resource_assignments (resource_id, assignment_start, assignment_finish);
SELECT attach_updated_trigger('resource_assignments');
