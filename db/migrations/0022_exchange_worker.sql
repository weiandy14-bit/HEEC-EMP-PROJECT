-- Asynchronous exchange worker queue (opt-in 202 path). Sync 201 remains unchanged.
-- One durable queue row per unit of background work (scan an import, render an export),
-- with lease-based claim/reclaim, bounded retries with exponential backoff, and dead-letter.
CREATE TABLE exchange_worker_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  project_id    uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('scan','render')),
  import_job_id uuid,
  export_job_id uuid,
  state         job_state NOT NULL DEFAULT 'pending',
  attempts      integer NOT NULL DEFAULT 0,
  available_at  timestamptz NOT NULL DEFAULT now(),
  lease_until   timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  version       bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_worker_project FOREIGN KEY (org_id, project_id)
    REFERENCES projects (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_worker_target CHECK (
    (kind = 'scan'   AND import_job_id IS NOT NULL AND export_job_id IS NULL) OR
    (kind = 'render' AND export_job_id IS NOT NULL AND import_job_id IS NULL)),
  CONSTRAINT fk_worker_import FOREIGN KEY (import_job_id) REFERENCES import_jobs (id) ON DELETE CASCADE,
  CONSTRAINT fk_worker_export FOREIGN KEY (export_job_id) REFERENCES export_jobs (id) ON DELETE CASCADE
);
-- At most one queue row per target, so re-enqueue (idempotent accept) never double-schedules work.
CREATE UNIQUE INDEX uq_worker_scan ON exchange_worker_jobs (import_job_id) WHERE kind = 'scan';
CREATE UNIQUE INDEX uq_worker_render ON exchange_worker_jobs (export_job_id) WHERE kind = 'render';
-- Ready/stale-lease lookup for the claim query.
CREATE INDEX ix_worker_ready ON exchange_worker_jobs (available_at) WHERE state IN ('pending','failed','running');
SELECT attach_updated_trigger('exchange_worker_jobs');
