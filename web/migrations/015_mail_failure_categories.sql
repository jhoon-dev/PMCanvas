CREATE TABLE pm_mail_failures (
  category text PRIMARY KEY CHECK(category IN ('connection','tls','auth','recipient','other')),
  occurrences bigint NOT NULL DEFAULT 1 CHECK(occurrences>0),
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);
