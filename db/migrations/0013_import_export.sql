-- =============================================================================
-- 0013_import_export.sql — 匯入 / 匯出工作（MSP 交換，§9）
-- =============================================================================

CREATE TABLE import_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id            uuid NOT NULL,
  source_type           text NOT NULL,   -- csv / xlsx / xml
  object_key            text NOT NULL,
  mapping               jsonb NOT NULL DEFAULT '{}'::jsonb,
  locale                text NOT NULL DEFAULT 'zh-TW',
  timezone              text NOT NULL DEFAULT 'Asia/Taipei',
  idempotency_key       text NOT NULL,
  state                 job_state NOT NULL DEFAULT 'pending',
  validation_report_key text,
  result                jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiated_by          uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid,
  version               bigint NOT NULL DEFAULT 1,
  archived_at           timestamptz,
  CONSTRAINT fk_import_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_import_idem UNIQUE (project_id, idempotency_key)
);
CREATE INDEX ix_import_project ON import_jobs (project_id, created_at DESC);
SELECT attach_updated_trigger('import_jobs');

CREATE TABLE export_jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id             uuid,       -- 可空（跨案匯出）
  format                 text NOT NULL,   -- csv / xlsx / xml
  filters                jsonb NOT NULL DEFAULT '{}'::jsonb,
  state                  job_state NOT NULL DEFAULT 'pending',
  output_key             text,
  conversion_report_key  text,
  initiated_by           uuid,
  expires_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_by             uuid,
  version                bigint NOT NULL DEFAULT 1,
  archived_at            timestamptz,
  CONSTRAINT fk_export_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_export_project ON export_jobs (project_id, created_at DESC);
SELECT attach_updated_trigger('export_jobs');

-- 外部識別對照（保留 MSP Unique ID / GUID；不使用行號為永久 ID，§9）
CREATE TABLE external_id_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id    uuid NOT NULL,
  system        text NOT NULL DEFAULT 'msproject',
  external_id   text NOT NULL,       -- Unique ID 或 GUID
  entity_type   text NOT NULL,       -- task / resource / ...
  entity_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  version       bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_extid_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_extid UNIQUE (project_id, system, entity_type, external_id)
);
SELECT attach_updated_trigger('external_id_map');
