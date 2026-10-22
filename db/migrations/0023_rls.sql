-- Phase 6 row-level security: organization isolation as defense-in-depth beneath
-- the application-layer scope checks. Row visibility is keyed on a transaction-
-- local GUC app.current_org, which the application sets per request
-- (SET LOCAL app.current_org = '<org uuid>'). When the GUC is unset or empty the
-- key resolves to NULL, so no rows match (fail-closed).
--
-- Enforcement model: PostgreSQL superusers bypass RLS by design, so the policies
-- bite only when the application connects as the least-privilege role app_rw
-- (production). Development/CI run the API as a superuser (policies dormant, the
-- existing app-layer checks remain primary) and prove the policies via an
-- integration test that SET ROLE app_rw. FORCE ROW LEVEL SECURITY additionally
-- subjects a non-superuser table owner to the policies.

-- 1) Least-privilege application role (production connects as this).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
-- Global reference tables are read-only to the application.
REVOKE INSERT, UPDATE, DELETE ON disciplines, permissions FROM app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;

-- Current org from the GUC; NULL when unset/empty (fail-closed).
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_org', true), '')::uuid
$$ LANGUAGE sql STABLE;

-- 2) Enable RLS + FORCE + org policy on every ordinary/partitioned base table
--    that carries org_id (partition children inherit the parent's policy).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id'
                          AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relispartition = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
    EXECUTE format(
      $f$CREATE POLICY org_isolation ON public.%I
         USING (org_id = app_current_org())
         WITH CHECK (org_id = app_current_org())$f$, r.relname);
  END LOOP;
END $$;

-- 3) organizations: the primary key IS the org id.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organizations
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

-- 4) Tables linked to an org only through a parent row.
ALTER TABLE baseline_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON baseline_tasks
  USING (EXISTS (SELECT 1 FROM baselines b WHERE b.id = baseline_tasks.baseline_id AND b.org_id = app_current_org()))
  WITH CHECK (EXISTS (SELECT 1 FROM baselines b WHERE b.id = baseline_tasks.baseline_id AND b.org_id = app_current_org()));

ALTER TABLE baseline_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON baseline_assignments
  USING (EXISTS (SELECT 1 FROM baselines b WHERE b.id = baseline_assignments.baseline_id AND b.org_id = app_current_org()))
  WITH CHECK (EXISTS (SELECT 1 FROM baselines b WHERE b.id = baseline_assignments.baseline_id AND b.org_id = app_current_org()));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON role_permissions
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.org_id = app_current_org()))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.org_id = app_current_org()));

-- 5) Views must evaluate underlying-table RLS with the invoker's rights, not the
--    (superuser) view owner's, or they would leak across orgs.
ALTER VIEW v_gantt_task SET (security_invoker = on);

-- Note: disciplines and permissions are global reference data (read-only to the
-- app, no org column) and are intentionally left without row policies.
-- outbox_consumed is a global event-dedup table with no org column.
