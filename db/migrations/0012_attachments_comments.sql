-- =============================================================================
-- 0012_attachments_comments.sql — 附件、評論（polymorphic：entity_type/entity_id + 白名單）
-- =============================================================================
-- 見 §4：polymorphic 以 entity_type/entity_id 加白名單及服務檢查；於應用層強制。

CREATE TABLE attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id     uuid NOT NULL,
  entity_type    text NOT NULL,   -- 白名單：task / review / meeting / deliverable / ...
  entity_id      uuid NOT NULL,
  object_key     text NOT NULL,   -- 私有物件儲存鍵
  filename       text NOT NULL,
  mime           text,
  size_bytes     bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256         text,
  scan_status    scan_status NOT NULL DEFAULT 'pending',
  version_no     int NOT NULL DEFAULT 1,
  uploaded_by    uuid,
  retention_until timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_by     uuid,
  version        bigint NOT NULL DEFAULT 1,
  archived_at    timestamptz,
  CONSTRAINT fk_attach_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_attach_object_key UNIQUE (object_key)
);
CREATE INDEX ix_attach_entity ON attachments (project_id, entity_type, entity_id);
SELECT attach_updated_trigger('attachments');

-- meetings.minutes_attachment_id 延遲 FK
ALTER TABLE meetings
  ADD CONSTRAINT fk_meetings_minutes FOREIGN KEY (minutes_attachment_id)
  REFERENCES attachments (id) ON DELETE RESTRICT;

CREATE TABLE comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id        uuid NOT NULL,
  entity_type       text NOT NULL,
  entity_id         uuid NOT NULL,
  body_sanitized    text NOT NULL,   -- 已消毒（防 XSS）
  author_id         uuid,
  parent_comment_id uuid REFERENCES comments (id) ON DELETE RESTRICT,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  version           bigint NOT NULL DEFAULT 1,
  archived_at       timestamptz,
  CONSTRAINT fk_comments_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_comments_entity ON comments (project_id, entity_type, entity_id);
SELECT attach_updated_trigger('comments');
