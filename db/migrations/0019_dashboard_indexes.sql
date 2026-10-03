-- Live dashboard keyset and scope indexes. No materialization or data cache.
CREATE INDEX ix_tasks_org_project_sort_id ON project_tasks(org_id,project_id,sort_key,id) WHERE archived_at IS NULL;
CREATE INDEX ix_tasks_project_updated ON project_tasks(project_id,updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_dependencies_project_updated ON task_dependencies(project_id,updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_schedule_success_finish ON schedule_runs(project_id,finished_at DESC) WHERE status='succeeded';
CREATE INDEX ix_resource_calendar_priority ON resource_calendars(org_id,resource_id,priority DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_deliverables_project_due ON deliverables(org_id,project_id,due_at) WHERE archived_at IS NULL;
CREATE INDEX ix_meetings_project_starts ON meetings(org_id,project_id,starts_at) WHERE archived_at IS NULL;
