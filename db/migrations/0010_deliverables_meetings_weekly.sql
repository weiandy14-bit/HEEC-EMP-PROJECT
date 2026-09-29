-- =============================================================================
-- 0010_deliverables_meetings_weekly.sql — 交付物、會議、每週工作項
-- =============================================================================

CREATE TABLE deliverables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id   uuid NOT NULL,
  task_id      uuid,
  name         text NOT NULL,
  type         text,
  revision     text NOT NULL DEFAULT 'A',
  status       text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected', 'locked')),
  due_at       timestamptz,
  submitted_at timestamptz,
  accepted_at  timestamptz,
  approver_id  uuid,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  version      bigint NOT NULL DEFAULT 1,
  archived_at  timestamptz,
  CONSTRAINT fk_deliv_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_deliv_task FOREIGN KEY (project_id, task_id)
    REFERENCES project_tasks (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_deliv UNIQUE (project_id, name, revision)
);
CREATE INDEX ix_deliv_project_due ON deliverables (project_id, due_at);
SELECT attach_updated_trigger('deliverables');

CREATE TABLE meetings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id            uuid NOT NULL,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz,
  timezone              text NOT NULL DEFAULT 'Asia/Taipei',
  topic                 text NOT NULL,
  organizer_id          uuid,
  status                text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'held', 'cancelled')),
  minutes_attachment_id uuid,     -- 延遲 FK 至 attachments
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  version               bigint NOT NULL DEFAULT 1,
  archived_at           timestamptz,
  CONSTRAINT fk_meetings_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_meetings_org_id UNIQUE (org_id, id),
  CONSTRAINT ck_meetings_range CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX ix_meetings_project_start ON meetings (project_id, starts_at);
SELECT attach_updated_trigger('meetings');

-- 每週工作項（跨週進行項每週顯示但不重複建立：source_key 去重）
CREATE TABLE weekly_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id     uuid NOT NULL,
  task_id        uuid,
  review_step_id uuid REFERENCES project_statutory_review_steps (id) ON DELETE RESTRICT,
  meeting_id     uuid,
  type           text NOT NULL,   -- 交圖 / 送審 / 會議 / 其他
  title          text NOT NULL,
  due_at         timestamptz,
  owner_id       uuid,
  status         text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'carried')),
  carried_from_id uuid REFERENCES weekly_items (id) ON DELETE RESTRICT,
  completed_at   timestamptz,
  source_key     text NOT NULL,   -- 去重鍵（rule/entity/period）
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_by     uuid,
  version        bigint NOT NULL DEFAULT 1,
  archived_at    timestamptz,
  CONSTRAINT fk_weekly_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_weekly_task FOREIGN KEY (project_id, task_id)
    REFERENCES project_tasks (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_weekly_meeting FOREIGN KEY (org_id, meeting_id)
    REFERENCES meetings (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_weekly_source UNIQUE (project_id, source_key)
);
CREATE INDEX ix_weekly_due_status ON weekly_items (due_at, status);
SELECT attach_updated_trigger('weekly_items');
