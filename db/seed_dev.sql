-- 開發種子：組織、PM 使用者、標準台北日曆（週一至週五 09-12,13-18）。
-- 用法：psql "$DATABASE_URL" -f db/seed_dev.sql
INSERT INTO organizations (id, code, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'ORG1', '示範組織')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, org_id, issuer, subject, email, display_name)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'https://idp.example', 'pm-subject', 'pm@example.com', 'PM')
ON CONFLICT DO NOTHING;

INSERT INTO calendars (id, org_id, name, timezone, hours_per_day)
VALUES ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-1111-1111-111111111111', '標準台北', 'Asia/Taipei', 8)
ON CONFLICT DO NOTHING;

INSERT INTO calendar_working_days (org_id, calendar_id, weekday, local_start, local_end)
SELECT '11111111-1111-1111-1111-111111111111',
       '33333333-3333-4333-8333-333333333333', wd, s::time, e::time
FROM (VALUES
  (1,'09:00','12:00'),(1,'13:00','18:00'),(2,'09:00','12:00'),(2,'13:00','18:00'),
  (3,'09:00','12:00'),(3,'13:00','18:00'),(4,'09:00','12:00'),(4,'13:00','18:00'),
  (5,'09:00','12:00'),(5,'13:00','18:00')
) AS v(wd,s,e)
ON CONFLICT DO NOTHING;
