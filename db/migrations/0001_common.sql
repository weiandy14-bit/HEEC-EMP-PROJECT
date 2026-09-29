-- =============================================================================
-- 0001_common.sql — 擴充、共通函式、共通列舉
-- =============================================================================
-- 共通約定（見規格 §4）：
--   所有主表：id uuid PK、org_id uuid FK organizations（全域字典除外）、
--             created_at/updated_at timestamptz、created_by/updated_by uuid、
--             version bigint、archived_at timestamptz NULL。
--   不可變快照/稽核採 append-only。
--   時間點 UTC timestamptz、民用純日期 date、時區 IANA 字串。
--   *_id 均 FK、刪除 RESTRICT。跨組織 FK 使用複合 (org_id,id)；
--   跨案依賴以複合 (project_id,id) 強制同案。
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- 排它約束（日期區間、複合唯一）

-- -----------------------------------------------------------------------------
-- updated_at 自動維護：每次 UPDATE 觸發，並遞增 version（樂觀鎖）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_row_updated()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 便利巨集：為具備共通欄位之表掛上 updated 觸發器
CREATE OR REPLACE FUNCTION attach_updated_trigger(target regclass)
RETURNS void AS $$
DECLARE
  trg_name text := 'trg_set_updated_' || split_part(target::text, '.', -1);
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION set_row_updated()',
    trg_name, target);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 共通列舉型別
-- -----------------------------------------------------------------------------
CREATE TYPE entity_status AS ENUM ('active', 'inactive', 'archived');

-- 排程關係（相依）：完成-開始 / 開始-開始 / 完成-完成 / 開始-完成
CREATE TYPE dependency_relation AS ENUM ('FS', 'SS', 'FF', 'SF');

-- 工作限制型別（MSP 對應）
CREATE TYPE constraint_type AS ENUM (
  'ASAP',                 -- 越早越好（預設）
  'ALAP',                 -- 越晚越好
  'SNET',                 -- Start No Earlier Than
  'SNLT',                 -- Start No Later Than
  'FNET',                 -- Finish No Earlier Than
  'FNLT',                 -- Finish No Later Than
  'MSO',                  -- Must Start On
  'MFO'                   -- Must Finish On
);

-- 工作型別
CREATE TYPE task_type AS ENUM ('task', 'milestone', 'summary', 'anchor');

-- 排程計算模式（見 D16）
CREATE TYPE schedule_mode AS ENUM ('fixed_duration', 'fixed_work', 'fixed_units');

-- 適用性（專業 / 審查）
CREATE TYPE applicability AS ENUM ('applicable', 'not_applicable', 'pending');

-- 版本狀態（模板 / 審查模板）
CREATE TYPE version_status AS ENUM ('draft', 'published', 'retired');

-- 警示嚴重度（normal < attention < behind < overdue）
CREATE TYPE alert_severity AS ENUM ('normal', 'attention', 'behind', 'overdue');
CREATE TYPE alert_state AS ENUM ('open', 'ack', 'snoozed', 'closed');

-- 專案健康度（取未關閉最高級警示映射）
CREATE TYPE project_health AS ENUM ('normal', 'attention', 'behind', 'overdue');

-- 背景工作 / 匯入匯出狀態
CREATE TYPE job_state AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'dead');

-- 附件掃描狀態
CREATE TYPE scan_status AS ENUM ('pending', 'clean', 'infected', 'error');

COMMENT ON FUNCTION set_row_updated() IS '更新 updated_at 並遞增 version（樂觀併發控制）';
