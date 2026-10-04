-- Exchange retention: purge markers for expired files, and a guarded path for
-- deleting expired immutable previews. Previews stay immutable for every normal
-- path; only a retention sweep that sets app.retention_sweep='on' within its own
-- transaction may DELETE expired rows. UPDATE remains blocked unconditionally.
ALTER TABLE import_jobs ADD COLUMN purged_at timestamptz;
ALTER TABLE export_jobs ADD COLUMN purged_at timestamptz;

CREATE OR REPLACE FUNCTION reject_preview_mutation() RETURNS trigger AS $$ BEGIN
 IF TG_OP='DELETE' AND current_setting('app.retention_sweep', true)='on' THEN
  RETURN OLD; -- retention sweep only; the sweep sets this flag transaction-locally
 END IF;
 RAISE EXCEPTION 'exchange preview is immutable' USING ERRCODE='restrict_violation';
END; $$ LANGUAGE plpgsql;
