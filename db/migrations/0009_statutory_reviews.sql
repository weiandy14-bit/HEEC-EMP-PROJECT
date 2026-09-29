-- =============================================================================
-- 0009_statutory_reviews.sql — 法定審查模板、案件審查、審查步驟、審查事件
-- =============================================================================
-- 審查模板版本化、發布後唯讀；案件保留採用之 version 與 step snapshot（§6、D04）。

CREATE TABLE statutory_review_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code              text NOT NULL,
  name              text NOT NULL,
  jurisdiction_scope text,     -- 縣市 / 用途 / 主管機關範圍
  discipline_id     uuid REFERENCES disciplines (id) ON DELETE RESTRICT,
  status            entity_status NOT NULL DEFAULT 'active',
  current_version   int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  version           bigint NOT NULL DEFAULT 1,
  archived_at       timestamptz,
  CONSTRAINT uq_srt_code UNIQUE (org_id, code)
);
SELECT attach_updated_trigger('statutory_review_templates');

-- 種子九類審查（管理模板，非宣稱全國一致法定先後）
INSERT INTO statutory_review_templates (org_id, code, name)
SELECT o.id, v.code, v.name
FROM organizations o
CROSS JOIN (VALUES
  ('POWER',    '電力/用電'),
  ('FIRE',     '消防'),
  ('TELECOM',  '電信'),
  ('SEWER',    '污水/下水道'),
  ('DETENTION','雨水貯留/滯洪'),
  ('RAINHARV', '雨水回收'),
  ('WATER',    '自來水'),
  ('GREEN',    '綠建築/節能'),
  ('LOCAL',    '地方其他')
) AS v(code, name)
WHERE false;  -- 種子於實際部署時依組織填入；此處僅示意結構

-- 審查模板步驟（發布後不可變）
CREATE TABLE statutory_review_template_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES statutory_review_templates (id) ON DELETE RESTRICT,
  version_no  int NOT NULL,
  step_code   text NOT NULL,
  sequence    int NOT NULL,
  name        text NOT NULL,
  required    boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     bigint NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CONSTRAINT uq_srts UNIQUE (template_id, version_no, step_code)
);
SELECT attach_updated_trigger('statutory_review_template_steps');

-- 案件審查（採用之模板版本；N/A 必填理由；pending 必填責任人與期限）
CREATE TABLE project_statutory_reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id           uuid NOT NULL,
  template_id          uuid NOT NULL REFERENCES statutory_review_templates (id) ON DELETE RESTRICT,
  template_version     int NOT NULL,
  applicability        applicability NOT NULL DEFAULT 'pending',
  na_reason            text,
  confirmation_due_date date,
  confirmation_owner_id uuid,
  authority            text,     -- 主管機關
  responsible_org      text,
  legal_due_date       date,     -- 法定期限（硬/軟規則 D05）
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'revision', 'approved', 'rejected', 'na')),
  approval_number      text,
  approval_date        date,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_by           uuid,
  version              bigint NOT NULL DEFAULT 1,
  archived_at          timestamptz,
  CONSTRAINT fk_psr_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_psr UNIQUE (project_id, template_id),
  CONSTRAINT uq_psr_project_id UNIQUE (project_id, id),
  -- N/A 必填理由；pending 必填責任人與期限
  CONSTRAINT ck_psr_na CHECK (applicability <> 'not_applicable' OR na_reason IS NOT NULL),
  CONSTRAINT ck_psr_pending CHECK (
    applicability <> 'pending'
    OR (confirmation_owner_id IS NOT NULL AND confirmation_due_date IS NOT NULL))
);
CREATE INDEX ix_psr_project ON project_statutory_reviews (project_id, status);
SELECT attach_updated_trigger('project_statutory_reviews');

-- project_tasks.statutory_review_id 延遲 FK
ALTER TABLE project_tasks
  ADD CONSTRAINT fk_tasks_review FOREIGN KEY (project_id, statutory_review_id)
  REFERENCES project_statutory_reviews (project_id, id) ON DELETE RESTRICT;

-- 案件審查步驟（送審與補正循環用 cycle_no，補正可多輪）
CREATE TABLE project_statutory_review_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  review_id        uuid NOT NULL REFERENCES project_statutory_reviews (id) ON DELETE RESTRICT,
  template_step_id uuid REFERENCES statutory_review_template_steps (id) ON DELETE RESTRICT,
  step_code        text NOT NULL,
  cycle_no         int NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'submitted', 'passed', 'revision', 'failed')),
  planned_at       timestamptz,
  actual_at        timestamptz,
  due_at           timestamptz,
  owner_id         uuid,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          bigint NOT NULL DEFAULT 1,
  archived_at      timestamptz,
  CONSTRAINT uq_psrs UNIQUE (review_id, cycle_no, step_code)
);
CREATE INDEX ix_psrs_review ON project_statutory_review_steps (review_id, cycle_no);
SELECT attach_updated_trigger('project_statutory_review_steps');

-- 審查事件（append-only 稽核）
CREATE TABLE review_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  review_id   uuid NOT NULL REFERENCES project_statutory_reviews (id) ON DELETE RESTRICT,
  step_id     uuid REFERENCES project_statutory_review_steps (id) ON DELETE RESTRICT,
  event_type  text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_review_events_review ON review_events (review_id, occurred_at DESC);
