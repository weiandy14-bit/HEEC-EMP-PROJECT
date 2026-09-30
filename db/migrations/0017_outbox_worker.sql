-- =============================================================================
-- 0017_outbox_worker.sql — outbox 消費冪等與效果表（P3-08）
-- =============================================================================
-- worker 以 event_id 去重確保「恰一次」作用（重投同事件不重複套用效果）。

-- 已消費事件（event_id 去重表）
CREATE TABLE outbox_consumed (
  event_id    uuid PRIMARY KEY,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

-- 事件效果（示範 worker 之可觀察作用；每事件至多一筆）
CREATE TABLE event_effects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  event_id   uuid NOT NULL,
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_effect UNIQUE (event_id)
);
CREATE INDEX ix_event_effects_org ON event_effects (org_id, created_at DESC);
