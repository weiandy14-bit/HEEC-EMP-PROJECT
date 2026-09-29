-- =============================================================================
-- 0004_calendars.sql — 日曆、工作日、例外（假日）、資源日曆
-- =============================================================================
-- 工作日模型（見 §7、D07–D09）：內部以分鐘計；工作時段以 local_time + timezone；
-- 例外用於國定假日與加班（人工匯入正式公告，D08）。

CREATE TABLE calendars (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  name               text NOT NULL,
  timezone           text NOT NULL DEFAULT 'Asia/Taipei',
  hours_per_day      numeric(5,2) NOT NULL DEFAULT 8.0 CHECK (hours_per_day > 0),
  status             entity_status NOT NULL DEFAULT 'active',
  parent_calendar_id uuid REFERENCES calendars (id) ON DELETE RESTRICT,  -- 繼承基底
  effective_from     date,
  effective_to       date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  version            bigint NOT NULL DEFAULT 1,
  archived_at        timestamptz,
  CONSTRAINT uq_calendars_org_id UNIQUE (org_id, id),
  CONSTRAINT ck_calendars_effective CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX ix_calendars_org_status ON calendars (org_id, status);
SELECT attach_updated_trigger('calendars');

-- projects.default_calendar_id 之延遲 FK（calendars 已存在後補上）
ALTER TABLE projects
  ADD CONSTRAINT fk_projects_calendar FOREIGN KEY (org_id, default_calendar_id)
  REFERENCES calendars (org_id, id) ON DELETE RESTRICT;

-- 每週工作時段（weekday 0=週日..6=週六；每日可有多段，如 09-12、13-18）
CREATE TABLE calendar_working_days (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  calendar_id    uuid NOT NULL,
  weekday        int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  local_start    time NOT NULL,
  local_end      time NOT NULL,
  capacity_units numeric(6,4) NOT NULL DEFAULT 1.0 CHECK (capacity_units >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_by     uuid,
  version        bigint NOT NULL DEFAULT 1,
  archived_at    timestamptz,
  CONSTRAINT fk_cwd_calendar FOREIGN KEY (org_id, calendar_id)
    REFERENCES calendars (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_cwd UNIQUE (calendar_id, weekday, local_start),
  CONSTRAINT ck_cwd_range CHECK (local_end > local_start)
);
CREATE INDEX ix_cwd_calendar ON calendar_working_days (calendar_id, weekday);
SELECT attach_updated_trigger('calendar_working_days');

-- 日曆例外（特定日期覆寫：假日=available_minutes 0；加班=額外時段）
CREATE TABLE calendar_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  calendar_id      uuid NOT NULL,
  local_date       date NOT NULL,
  local_start      time,             -- NULL 表示整日（配合 available_minutes）
  local_end        time,
  available_minutes int NOT NULL DEFAULT 0 CHECK (available_minutes >= 0),
  reason           text,
  source           text,             -- 'government' / 'company' / 'manual'
  revision         int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          bigint NOT NULL DEFAULT 1,
  archived_at      timestamptz,
  CONSTRAINT fk_cex_calendar FOREIGN KEY (org_id, calendar_id)
    REFERENCES calendars (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_cex UNIQUE (calendar_id, local_date, local_start, revision),
  CONSTRAINT ck_cex_range CHECK (local_end IS NULL OR local_start IS NULL OR local_end > local_start)
);
CREATE INDEX ix_cex_calendar_date ON calendar_exceptions (calendar_id, local_date);
SELECT attach_updated_trigger('calendar_exceptions');
