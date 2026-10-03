-- G10 實績一致性（§7）：完成=100% 須有完成日期；有完成日期須 100%。
-- 由 project_tasks 之 CHECK ck_tasks_complete 保證。ON_ERROR_STOP=1。
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO projects (id, org_id, code, name, permit_filing_date, default_calendar_id, created_by, updated_by)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'G10-ACT', 'G10 實績測試', '2027-01-11',
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

-- 正例：percent=100 且有完成日期（含開始）→ 允許
INSERT INTO project_tasks (org_id, project_id, wbs_code, sort_key, name, duration_minutes,
                           percent_complete, actual_start, actual_finish, created_by, updated_by)
VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000001',
        '1.0', '1.0', '已完成工作', 480, 100,
        '2027-01-04T09:00:00+08:00', '2027-01-04T18:00:00+08:00',
        '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');
\echo 'OK: percent=100 + actual_finish 正例通過'

-- 正例：percent=0、無完成日期 → 允許
INSERT INTO project_tasks (org_id, project_id, wbs_code, sort_key, name, duration_minutes,
                           percent_complete, created_by, updated_by)
VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000001',
        '2.0', '2.0', '未開始工作', 480, 0,
        '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');
\echo 'OK: percent=0 未完成 正例通過'

-- 負例 A：percent=100 但無完成日期 → 應違反 CHECK
DO $$
BEGIN
  BEGIN
    INSERT INTO project_tasks (org_id, project_id, wbs_code, sort_key, name, duration_minutes,
                               percent_complete, created_by, updated_by)
    VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000001',
            '3.0', '3.0', '宣稱完成但無日期', 480, 100,
            '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'ASSERT_FAIL: percent=100 無完成日期 竟然被接受';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'ASSERT_FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'OK: percent=100 無完成日期 被正確拒絕 (%)', SQLERRM;
  END;
END $$;

-- 負例 B：有完成日期但 percent<100 → 應違反 CHECK
DO $$
BEGIN
  BEGIN
    INSERT INTO project_tasks (org_id, project_id, wbs_code, sort_key, name, duration_minutes,
                               percent_complete, actual_start, actual_finish, created_by, updated_by)
    VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000001',
            '4.0', '4.0', '有完成日期但未滿 100', 480, 50,
            '2027-01-04T09:00:00+08:00', '2027-01-04T18:00:00+08:00',
            '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'ASSERT_FAIL: 有完成日期但 percent<100 竟然被接受';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'ASSERT_FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'OK: 有完成日期但 percent<100 被正確拒絕 (%)', SQLERRM;
  END;
END $$;

ROLLBACK;
\echo 'G10 actual consistency: PASS'
