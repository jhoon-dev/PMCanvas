CREATE TABLE pm_users (
 id uuid PRIMARY KEY,
 email text NOT NULL UNIQUE,
 name text NOT NULL,
 password_hash text NOT NULL,
 is_admin boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pm_sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES pm_users(id) ON DELETE CASCADE,
 csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX ON pm_sessions(expires_at);
CREATE TABLE pm_projects (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 description text NOT NULL DEFAULT '',
 holidays jsonb NOT NULL DEFAULT '[]',
 demo boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pm_project_access (
 project_id uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES pm_users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','editor','viewer')),
 PRIMARY KEY(project_id,user_id)
);
CREATE UNIQUE INDEX pm_project_one_owner ON pm_project_access(project_id) WHERE role='owner';
CREATE INDEX ON pm_project_access(user_id);
CREATE TABLE pm_members (
 project_id uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
 id text NOT NULL,
 position integer NOT NULL,
 name text NOT NULL,
 role text NOT NULL,
 grade text NOT NULL,
 hours numeric NOT NULL CHECK(hours>0 AND hours<=16),
 allocation numeric NOT NULL CHECK(allocation>0 AND allocation<=100),
 PRIMARY KEY(project_id,id)
);
CREATE TABLE pm_tasks (
 project_id uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
 id text NOT NULL,
 position integer NOT NULL,
 name text NOT NULL,
 phase text NOT NULL DEFAULT '',
 owner_id text,
 start_date date NOT NULL,
 end_date date NOT NULL,
 predecessor_id text,
 memo text NOT NULL DEFAULT '',
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,owner_id) REFERENCES pm_members(project_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(project_id,predecessor_id) REFERENCES pm_tasks(project_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(end_date>=start_date)
);
CREATE TABLE pm_task_items (
 project_id uuid NOT NULL,
 id text NOT NULL,
 task_id text NOT NULL,
 position integer NOT NULL,
 title text NOT NULL,
 hours numeric NOT NULL CHECK(hours>0 AND hours<=10000),
 done_date date,
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,task_id) REFERENCES pm_tasks(project_id,id) ON DELETE CASCADE
);
CREATE INDEX ON pm_task_items(project_id,done_date);
CREATE TABLE pm_project_events (
 id bigserial PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES pm_users(id),
 revision integer NOT NULL,
 event_type text NOT NULL,
 changes jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pm_project_events(project_id,id DESC);
