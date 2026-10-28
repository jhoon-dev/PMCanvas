CREATE TABLE pm_alert_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  enabled boolean NOT NULL DEFAULT false,
  recipients text[] NOT NULL DEFAULT '{}' CHECK(cardinality(recipients)<=10),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO pm_alert_settings(id) VALUES(true);
CREATE TABLE pm_operation_alerts (
  kind text PRIMARY KEY CHECK(kind IN ('backup','restore','mail')),
  occurrences bigint NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  acknowledged bigint NOT NULL DEFAULT 0,
  notified bigint NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  lease uuid,
  lease_until timestamptz
);
