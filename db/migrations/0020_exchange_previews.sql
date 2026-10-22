-- Immutable exchange previews and bounded file/job metadata.
ALTER TABLE import_jobs ADD CONSTRAINT uq_import_scope UNIQUE(org_id,project_id,id);
ALTER TABLE import_jobs ADD COLUMN input_hash text;
ALTER TABLE import_jobs ADD COLUMN scan_state scan_status NOT NULL DEFAULT 'pending';
ALTER TABLE import_jobs ADD COLUMN request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE import_jobs ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 days');
ALTER TABLE export_jobs ADD COLUMN idempotency_key text;
ALTER TABLE export_jobs ADD COLUMN input_hash text;
CREATE UNIQUE INDEX uq_export_idem ON export_jobs(project_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE project_tasks ADD COLUMN unassigned_work_minutes integer NOT NULL DEFAULT 0 CHECK(unassigned_work_minutes>=0);
CREATE TABLE import_preview_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 project_id uuid NOT NULL,
 import_job_id uuid NOT NULL,
 sequence_no integer NOT NULL CHECK(sequence_no>0),
 parser_version integer NOT NULL,
 payload jsonb NOT NULL,
 payload_hash text NOT NULL,
 vector_hash text NOT NULL,
 decision_hash text NOT NULL,
 errors jsonb NOT NULL DEFAULT '[]'::jsonb,
 warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '90 days'),
 CONSTRAINT fk_preview_job FOREIGN KEY(org_id,project_id,import_job_id) REFERENCES import_jobs(org_id,project_id,id) ON DELETE RESTRICT,
 CONSTRAINT uq_preview_seq UNIQUE(import_job_id,sequence_no)
);
CREATE INDEX ix_preview_job ON import_preview_versions(import_job_id,sequence_no DESC);
CREATE FUNCTION reject_preview_mutation() RETURNS trigger AS $$ BEGIN
 RAISE EXCEPTION 'exchange preview is immutable' USING ERRCODE='restrict_violation';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_exchange_preview_immutable BEFORE UPDATE OR DELETE ON import_preview_versions FOR EACH ROW EXECUTE FUNCTION reject_preview_mutation();
-- Polymorphic external identities must identify a real entity in their scope.
CREATE FUNCTION check_exchange_external_identity() RETURNS trigger AS $$ BEGIN
 IF NEW.entity_type='task' THEN
  IF NOT EXISTS(SELECT 1 FROM project_tasks WHERE id=NEW.entity_id AND project_id=NEW.project_id AND org_id=NEW.org_id) THEN
   RAISE EXCEPTION 'external task scope invalid' USING ERRCODE='foreign_key_violation'; END IF;
 ELSIF NEW.entity_type='resource' THEN
  IF NOT EXISTS(SELECT 1 FROM resources WHERE id=NEW.entity_id AND org_id=NEW.org_id) THEN
   RAISE EXCEPTION 'external resource scope invalid' USING ERRCODE='foreign_key_violation'; END IF;
 ELSE RAISE EXCEPTION 'unsupported external entity type' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_exchange_external_scope BEFORE INSERT OR UPDATE ON external_id_map FOR EACH ROW EXECUTE FUNCTION check_exchange_external_identity();
