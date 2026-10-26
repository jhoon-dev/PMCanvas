ALTER TABLE pm_backup_settings ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Seoul';
ALTER TABLE pm_backup_runs ADD COLUMN key_fingerprint text;

CREATE FUNCTION pm_next_backup_at(run_hour integer, zone text, at_time timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE sql STABLE AS $$
 SELECT (
   date_trunc('day',at_time AT TIME ZONE zone)
   + run_hour * interval '1 hour'
   + CASE WHEN extract(hour FROM at_time AT TIME ZONE zone)>=run_hour
          THEN interval '1 day' ELSE interval '0 day' END
 ) AT TIME ZONE zone
$$;
