-- G9 基準快照不可變：baseline_tasks/baseline_assignments 之 UPDATE/DELETE 必須被拒。
-- 以 ON_ERROR_STOP=1 執行；任一斷言失敗即整體失敗。
\set ON_ERROR_STOP on

BEGIN;

-- 前置：組織/專案/基準/明細（org 與 calendar 由 seed 提供）
INSERT INTO projects (id, org_id, code, name, permit_filing_date, default_calendar_id, created_by, updated_by)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'G9-BASE', 'G9 基準測試', '2027-01-11',
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

INSERT INTO baselines (id, org_id, project_id, sequence_no, created_from_schedule_version, status, captured_by, created_by, updated_by)
VALUES ('aaaaaaaa-0000-4000-8000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001',
        1, 0, 'active', '22222222-2222-4222-8222-222222222222',
        '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

INSERT INTO baseline_tasks (id, baseline_id, task_id, duration_minutes, work_minutes, task_name, wbs_code)
VALUES ('aaaaaaaa-0000-4000-8000-000000000003',
        'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-0000000000ff', 960, 960, '基本設計', '1.0');

-- 斷言 1：UPDATE 必須被拒
DO $$
BEGIN
  BEGIN
    UPDATE baseline_tasks SET duration_minutes = 1
      WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'ASSERT_FAIL: baseline_tasks UPDATE 竟然成功（應被拒）';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'ASSERT_FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'OK: baseline_tasks UPDATE 被正確封鎖 (%)', SQLERRM;
  END;
END $$;

-- 斷言 2：DELETE 必須被拒
DO $$
BEGIN
  BEGIN
    DELETE FROM baseline_tasks WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'ASSERT_FAIL: baseline_tasks DELETE 竟然成功（應被拒）';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'ASSERT_FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'OK: baseline_tasks DELETE 被正確封鎖 (%)', SQLERRM;
  END;
END $$;

-- 斷言 3：INSERT（建立新快照）仍應允許
INSERT INTO baseline_assignments (id, baseline_id, task_id, resource_id, work_minutes, units)
VALUES ('aaaaaaaa-0000-4000-8000-000000000004',
        'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-0000000000ff',
        'aaaaaaaa-0000-4000-8000-0000000000ee', 960, 1.0);

-- 斷言 4：baseline_assignments UPDATE 亦被拒
DO $$
BEGIN
  BEGIN
    UPDATE baseline_assignments SET work_minutes = 1
      WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'ASSERT_FAIL: baseline_assignments UPDATE 竟然成功（應被拒）';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'ASSERT_FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'OK: baseline_assignments UPDATE 被正確封鎖 (%)', SQLERRM;
  END;
END $$;

ROLLBACK; -- 測試資料不落地
\echo 'G9 baseline immutability: PASS'
