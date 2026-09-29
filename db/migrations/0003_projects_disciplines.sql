-- =============================================================================
-- 0003_projects_disciplines.sql — 專業字典、專案、專案成員、專案專業適用性
-- =============================================================================

-- 專業字典（全域；五大機電專業）
CREATE TABLE disciplines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     bigint NOT NULL DEFAULT 1,
  CONSTRAINT uq_disciplines_code UNIQUE (code)
);
SELECT attach_updated_trigger('disciplines');

-- 五筆初始資料（種子）
INSERT INTO disciplines (code, name, sort_order) VALUES
  ('ELEC',  '電氣',   1),
  ('ELV',   '弱電',   2),
  ('PLUMB', '給排水', 3),
  ('FIRE',  '消防',   4),
  ('HVAC',  '空調',   5);

-- 專案（建照掛件日為固定錨點；日期均為資料）
CREATE TABLE projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code                text NOT NULL,
  name                text NOT NULL,
  short_name          text,
  client_name         text,        -- 業主（聯絡資料，MVP 非帳號）
  architect_name      text,        -- 建築師
  pm_user_id          uuid,
  status              text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  priority            int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  design_start_date   date,
  permit_filing_date  date,        -- 掛件日：固定排程錨點（0.0）
  permit_issued_date  date,        -- 建照取得日：掛件後追蹤欄位（D02）
  default_calendar_id uuid,
  timezone            text NOT NULL DEFAULT 'Asia/Taipei',
  color               text,
  percent_complete    numeric(5,2) NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  health              project_health NOT NULL DEFAULT 'normal',
  notes               text,
  schedule_version    bigint NOT NULL DEFAULT 0,  -- 排程版本（樂觀鎖，重算遞增）
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  version             bigint NOT NULL DEFAULT 1,
  archived_at         timestamptz,
  CONSTRAINT uq_projects_code UNIQUE (org_id, code),
  CONSTRAINT fk_projects_pm FOREIGN KEY (org_id, pm_user_id)
    REFERENCES users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_projects_org_id UNIQUE (org_id, id)
);
CREATE INDEX ix_projects_status_filing ON projects (status, permit_filing_date);
CREATE INDEX ix_projects_pm_status ON projects (pm_user_id, status);
SELECT attach_updated_trigger('projects');

-- 專案成員（可依專業限定範圍）
CREATE TABLE project_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id          uuid NOT NULL,
  user_id             uuid NOT NULL,
  scope_discipline_id uuid REFERENCES disciplines (id) ON DELETE RESTRICT,
  role_code           text NOT NULL,   -- PM / Lead / Engineer / QA / Viewer
  active_from         date,
  active_to           date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  version             bigint NOT NULL DEFAULT 1,
  archived_at         timestamptz,
  CONSTRAINT fk_project_members_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_members_user FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_project_member UNIQUE (project_id, user_id, role_code, scope_discipline_id)
);
CREATE INDEX ix_project_members_project ON project_members (project_id);
SELECT attach_updated_trigger('project_members');

-- 專案專業適用性（每案啟用哪些專業；N/A 需理由與確認）
CREATE TABLE project_disciplines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id    uuid NOT NULL,
  discipline_id uuid NOT NULL REFERENCES disciplines (id) ON DELETE RESTRICT,
  applicability applicability NOT NULL DEFAULT 'pending',
  reason        text,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  version       bigint NOT NULL DEFAULT 1,
  archived_at   timestamptz,
  CONSTRAINT fk_project_disciplines_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_project_discipline UNIQUE (project_id, discipline_id),
  -- N/A 必填理由
  CONSTRAINT ck_project_discipline_na
    CHECK (applicability <> 'not_applicable' OR reason IS NOT NULL)
);
SELECT attach_updated_trigger('project_disciplines');
