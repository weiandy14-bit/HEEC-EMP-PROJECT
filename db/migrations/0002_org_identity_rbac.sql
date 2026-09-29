-- =============================================================================
-- 0002_org_identity_rbac.sql — 組織、身分、RBAC、團隊
-- =============================================================================

-- 組織（多組織隔離之邊界；MVP 單組織起步）
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Taipei',
  status      entity_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     bigint NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CONSTRAINT uq_org_code UNIQUE (code)
);
CREATE INDEX ix_org_status ON organizations (status);
SELECT attach_updated_trigger('organizations');

-- 為所有具 org_id 的表建立複合唯一鍵 (org_id, id)，供跨組織複合 FK 參照
ALTER TABLE organizations ADD CONSTRAINT uq_org_self UNIQUE (id);

-- 使用者（企業 OIDC SSO；subject+issuer 唯一）
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  issuer        text NOT NULL,
  subject       text NOT NULL,
  email         text NOT NULL,
  display_name  text NOT NULL,
  status        entity_status NOT NULL DEFAULT 'active',
  timezone      text NOT NULL DEFAULT 'Asia/Taipei',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  version       bigint NOT NULL DEFAULT 1,
  archived_at   timestamptz,
  CONSTRAINT uq_users_subject UNIQUE (issuer, subject),
  CONSTRAINT uq_users_org_id UNIQUE (org_id, id)
);
-- 啟用中 email 於組織內唯一（封存者不佔用）
CREATE UNIQUE INDEX uq_users_email_active
  ON users (org_id, lower(email)) WHERE archived_at IS NULL;
CREATE INDEX ix_users_email ON users (lower(email));
SELECT attach_updated_trigger('users');

-- 角色（系統角色 + 範圍型別 org/project/discipline）
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations (id) ON DELETE RESTRICT, -- NULL=系統全域角色
  code        text NOT NULL,
  name        text NOT NULL,
  system_role boolean NOT NULL DEFAULT false,
  scope_type  text NOT NULL CHECK (scope_type IN ('org', 'project', 'discipline')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     bigint NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CONSTRAINT uq_roles_code UNIQUE (org_id, code)
);
CREATE INDEX ix_roles_scope ON roles (scope_type);
SELECT attach_updated_trigger('roles');

-- 權限（resource + action）
CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource    text NOT NULL,
  action      text NOT NULL,
  code        text NOT NULL,
  description text,
  CONSTRAINT uq_permissions_code UNIQUE (code),
  CONSTRAINT uq_permissions_res_act UNIQUE (resource, action)
);

-- 角色-權限
CREATE TABLE role_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE RESTRICT,
  CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

-- 使用者-角色指派（含範圍與到期）
CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL,
  role_id     uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  scope_type  text NOT NULL CHECK (scope_type IN ('org', 'project', 'discipline')),
  scope_id    uuid,               -- 對應 project_id 或 discipline_id；org 範圍為 NULL
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     bigint NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CONSTRAINT fk_user_roles_user FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_user_role_scope UNIQUE (user_id, role_id, scope_type, scope_id)
);
CREATE INDEX ix_user_roles_user ON user_roles (user_id);
SELECT attach_updated_trigger('user_roles');

-- 團隊
CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code         text NOT NULL,
  name         text NOT NULL,
  lead_user_id uuid,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  version      bigint NOT NULL DEFAULT 1,
  archived_at  timestamptz,
  CONSTRAINT uq_teams_code UNIQUE (org_id, code),
  CONSTRAINT fk_teams_lead FOREIGN KEY (org_id, lead_user_id)
    REFERENCES users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_teams_org_id UNIQUE (org_id, id)
);
CREATE INDEX ix_teams_lead ON teams (lead_user_id);
SELECT attach_updated_trigger('teams');

-- 團隊成員（含配置比例、期間）
CREATE TABLE team_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  team_id          uuid NOT NULL,
  user_id          uuid NOT NULL,
  start_date       date NOT NULL,
  end_date         date,
  allocation_units numeric(6,4) NOT NULL DEFAULT 1.0 CHECK (allocation_units >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          bigint NOT NULL DEFAULT 1,
  archived_at      timestamptz,
  CONSTRAINT fk_team_members_team FOREIGN KEY (org_id, team_id)
    REFERENCES teams (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_team_members_user FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_team_member UNIQUE (team_id, user_id, start_date),
  CONSTRAINT ck_team_member_dates CHECK (end_date IS NULL OR end_date >= start_date)
);
SELECT attach_updated_trigger('team_members');

-- 登入事件（append-only）
CREATE TABLE login_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id     uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_ip   inet,
  client_id   text,
  outcome     text NOT NULL CHECK (outcome IN ('success', 'failure', 'mfa_required', 'locked')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_login_events_user ON login_events (user_id, occurred_at DESC);
