-- =============================================================================
-- 0011_alerts.sql — 警示規則、警示
-- =============================================================================
-- fingerprint = rule_code+entity+baseline_id+period；相同指紋更新 occurrence（§7）。

CREATE TABLE alert_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code           text NOT NULL,
  severity       alert_severity NOT NULL DEFAULT 'attention',
  condition_type text NOT NULL,
  parameters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope          text NOT NULL DEFAULT 'project',  -- project / task / review / resource_week
  enabled        boolean NOT NULL DEFAULT true,
  version_no     int NOT NULL DEFAULT 1,
  effective_from timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_by     uuid,
  version        bigint NOT NULL DEFAULT 1,
  archived_at    timestamptz,
  CONSTRAINT uq_alert_rules_code UNIQUE (org_id, code)
);
SELECT attach_updated_trigger('alert_rules');

CREATE TABLE alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id       uuid NOT NULL,
  rule_id          uuid NOT NULL REFERENCES alert_rules (id) ON DELETE RESTRICT,
  entity_type      text NOT NULL,   -- project / task / review / resource_week
  entity_id        uuid,
  severity         alert_severity NOT NULL,
  fingerprint      text NOT NULL,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  state            alert_state NOT NULL DEFAULT 'open',
  assignee_id      uuid,
  snooze_until     timestamptz,
  reason           text,            -- ack/snooze 理由（授權者需理由與到期日）
  occurrence_count int NOT NULL DEFAULT 1,
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 規則版本與輸入證據
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          bigint NOT NULL DEFAULT 1,
  archived_at      timestamptz,
  CONSTRAINT fk_alerts_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT
);
-- 未關閉之指紋於組織內唯一（相同指紋更新而非重建）
CREATE UNIQUE INDEX uq_alerts_fingerprint_open
  ON alerts (org_id, fingerprint) WHERE state <> 'closed';
CREATE INDEX ix_alerts_project_sev_state ON alerts (project_id, severity, state);
SELECT attach_updated_trigger('alerts');
