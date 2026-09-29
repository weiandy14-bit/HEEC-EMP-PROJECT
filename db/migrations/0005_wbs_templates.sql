-- =============================================================================
-- 0005_wbs_templates.sql — WBS 模板、版本、模板工作
-- =============================================================================
-- 模板發布後唯讀；修改建立新版本；既有案件不自動變更（見 §6）。

CREATE TABLE wbs_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code               text NOT NULL,
  name               text NOT NULL,
  owner_org_id       uuid REFERENCES organizations (id) ON DELETE RESTRICT,
  status             entity_status NOT NULL DEFAULT 'active',
  current_version_id uuid,   -- 延遲 FK 至 wbs_template_versions
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  version            bigint NOT NULL DEFAULT 1,
  archived_at        timestamptz,
  CONSTRAINT uq_wbs_templates_code UNIQUE (org_id, code)
);
SELECT attach_updated_trigger('wbs_templates');

CREATE TABLE wbs_template_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  template_id  uuid NOT NULL REFERENCES wbs_templates (id) ON DELETE RESTRICT,
  version_no   int NOT NULL,
  status       version_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  hash         text,        -- 發布時之內容雜湊（不可變）
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  version      bigint NOT NULL DEFAULT 1,
  archived_at  timestamptz,
  CONSTRAINT uq_wbs_tpl_version UNIQUE (template_id, version_no)
);
CREATE INDEX ix_wbs_tpl_versions_tpl ON wbs_template_versions (template_id, status);
SELECT attach_updated_trigger('wbs_template_versions');

ALTER TABLE wbs_templates
  ADD CONSTRAINT fk_wbs_templates_current FOREIGN KEY (current_version_id)
  REFERENCES wbs_template_versions (id) ON DELETE RESTRICT;

-- 模板工作（樹狀；含 duration、日曆政策、關係範本旗標）
CREATE TABLE wbs_template_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  version_id          uuid NOT NULL REFERENCES wbs_template_versions (id) ON DELETE RESTRICT,
  parent_id           uuid REFERENCES wbs_template_tasks (id) ON DELETE RESTRICT,
  wbs_code            text NOT NULL,       -- 如 "2.1"
  sort_key            text NOT NULL,
  name                text NOT NULL,
  description         text,
  discipline_id       uuid REFERENCES disciplines (id) ON DELETE RESTRICT,
  task_type           task_type NOT NULL DEFAULT 'task',
  duration_minutes    int NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  calendar_policy     text NOT NULL DEFAULT 'project',  -- project / resource / named
  deliverable_label   text,
  review_flag         boolean NOT NULL DEFAULT false,
  anchor_flag         boolean NOT NULL DEFAULT false,    -- 0.0 掛件錨點
  default_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  version             bigint NOT NULL DEFAULT 1,
  archived_at         timestamptz,
  CONSTRAINT uq_wbs_tpl_task_code UNIQUE (version_id, wbs_code)
);
CREATE INDEX ix_wbs_tpl_tasks_version ON wbs_template_tasks (version_id, sort_key);
SELECT attach_updated_trigger('wbs_template_tasks');
