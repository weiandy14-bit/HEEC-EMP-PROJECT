-- =============================================================================
-- 0014_audit_settings_infra.sql — 稽核、系統設定、outbox、schedule_runs
-- =============================================================================

-- 稽核（append-only、hash chain、按月分割；限獨立稽核角色）
CREATE TABLE audit_logs (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  actor_id       uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  source_ip      inet,
  client_id      text,
  entity_type    text NOT NULL,
  entity_id      uuid,
  action         text NOT NULL,
  diff_redacted  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 敏感欄位遮罩
  correlation_id text,
  request_id     text,
  integrity_hash text NOT NULL,
  previous_hash  text,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 首個分割區（實務上由排程建立每月分割）
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
CREATE INDEX ix_audit_org_time ON audit_logs (org_id, occurred_at DESC);
CREATE INDEX ix_audit_entity ON audit_logs (entity_type, entity_id);

-- 系統設定（版本化）
CREATE TABLE system_settings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  key            text NOT NULL,
  value          jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version int NOT NULL DEFAULT 1,
  effective_at   timestamptz NOT NULL DEFAULT now(),
  changed_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        bigint NOT NULL DEFAULT 1,
  CONSTRAINT uq_settings UNIQUE (org_id, key, effective_at)
);
SELECT attach_updated_trigger('system_settings');

-- 交易性 outbox（同交易寫入；worker 按 aggregate version 串行）
CREATE TABLE job_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  event_id          uuid NOT NULL DEFAULT gen_random_uuid(),
  aggregate_type    text NOT NULL,
  aggregate_id      uuid,
  aggregate_version bigint,
  type              text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  state             job_state NOT NULL DEFAULT 'pending',
  attempts          int NOT NULL DEFAULT 0,
  available_at      timestamptz NOT NULL DEFAULT now(),
  locked_at         timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_outbox_event UNIQUE (event_id)
);
CREATE INDEX ix_outbox_dispatch ON job_outbox (state, available_at);

-- 排程執行紀錄（冪等；input_hash 相同回傳原 run，§7 T09）
CREATE TABLE schedule_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id       uuid NOT NULL,
  input_hash       text NOT NULL,
  engine_version   text NOT NULL,
  calendar_revision text,
  idempotency_key  text,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'infeasible', 'failed')),
  result_hash      text,
  result           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 含 infeasible 路徑
  status_date      timestamptz,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  initiated_by     uuid,
  CONSTRAINT fk_schedule_runs_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_schedule_runs_project ON schedule_runs (project_id, started_at DESC);
CREATE UNIQUE INDEX uq_schedule_runs_idem
  ON schedule_runs (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
