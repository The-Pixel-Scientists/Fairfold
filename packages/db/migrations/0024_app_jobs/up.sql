-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0024, up: the pgboss schema, the queue register, the tenant
-- trigger on every job table and app.tenant_ids() (ADR 0009, S11-48).
--
-- pgboss and app.job_queue are the one named exception to architecture rule
-- 2, and only while ADR 0009's guards hold: payloads hold ids only, the
-- tenant comes from the transaction and the trigger below checks it, the
-- API and worker use separate roles, errors are stored as codes only, and
-- every job column is classified (classification/pgboss.ts). Every grant
-- here is listed in test/catalogue/pgboss.ts, and the catalogue test fails
-- on any other.
--
-- The block below is getConstructionPlans('pgboss') from pg-boss 12.35.0,
-- schema version 43, pasted, never generated at migrate time. Only its
-- BEGIN and COMMIT lines and trailing spaces are left out, since the
-- migrator already runs the batch in one transaction.
-- test/jobs/construction-plan.test.ts regenerates the plan from the
-- installed package and fails if this block differs, so a pg-boss upgrade
-- cannot land without a migration.

-- pg-boss construction plan: start
    SET LOCAL lock_timeout = 30000;
    SET LOCAL idle_in_transaction_session_timeout = 30000;
    SELECT pg_advisory_xact_lock(('x' || encode(sha224((current_database() || '.pgboss.pgboss')::bytea), 'hex'))::bit(64)::bigint);
CREATE SCHEMA IF NOT EXISTS pgboss;

    CREATE TYPE pgboss.job_state AS ENUM (
      'created',
      'retry',
      'active',
      'completed',
      'cancelled',
      'failed'
    )
  ;

    CREATE FUNCTION pgboss.job_now()
    RETURNS timestamp with time zone AS
    $$
      SELECT pg_catalog.now();
    $$
    LANGUAGE sql STABLE;
  ;

    CREATE TABLE pgboss.version (
      version int primary key,
      cron_on timestamp with time zone,
      bam_on timestamp with time zone,
      flow_on timestamp with time zone,
      reindex_on timestamp with time zone,
      monitor_backoff_on timestamp with time zone
    )
  ;

    CREATE TABLE pgboss.queue (
      name text NOT NULL,
      policy text NOT NULL,
      retry_limit int NOT NULL,
      retry_delay int NOT NULL,
      retry_backoff bool NOT NULL,
      retry_delay_max int,
      expire_seconds int NOT NULL,
      retention_seconds int NOT NULL,
      deletion_seconds int NOT NULL,
      dead_letter text REFERENCES pgboss.queue (name) CHECK (dead_letter IS DISTINCT FROM name),
      partition bool NOT NULL,
      table_name text NOT NULL,
      deferred_count int NOT NULL default 0,
      queued_count int NOT NULL default 0,
      ready_count int NOT NULL default 0,
      warning_queued int NOT NULL default 0,
      active_count int NOT NULL default 0,
      failed_count int NOT NULL default 0,
      total_count int NOT NULL default 0,
      created_delta int NOT NULL default 0,
      completed_delta int NOT NULL default 0,
      failed_delta int NOT NULL default 0,
      delta_on timestamp with time zone,
      delta_seconds int,
      ready_history int[] NOT NULL default '{}',
      heartbeat_seconds int,
      notify bool NOT NULL DEFAULT false,
      singletons_active text[],
      monitor_claim_on timestamp with time zone,
      monitor_on timestamp with time zone,
      maintain_on timestamp with time zone,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY (name)
    )
  ;

    CREATE TABLE pgboss.schedule (
      name text REFERENCES pgboss.queue ON DELETE CASCADE,
      key text not null DEFAULT '',
      kind text not null DEFAULT 'cron' CHECK (kind IN ('cron', 'rrule')),
      cron text not null,
      timezone text DEFAULT 'UTC',
      data jsonb,
      options jsonb,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      last_job_id uuid,
      PRIMARY KEY (name, key)
    )
  ;

    CREATE TABLE pgboss.subscription (
      event text not null,
      name text not null REFERENCES pgboss.queue ON DELETE CASCADE,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY(event, name)
    )
  ;

    CREATE TABLE pgboss.bam (
      id uuid PRIMARY KEY default gen_random_uuid(),
      name text NOT NULL,
      version int NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      queue text,
      table_name text NOT NULL,
      command text NOT NULL,
      error text,
      created_on timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone
    )
  ;

    CREATE FUNCTION pgboss.job_table_format(command text, table_name text)
    RETURNS text AS
    $$
      SELECT format(
        regexp_replace(
          regexp_replace(command, '\.job\y', '.%1$I', 'g'),
          '\yjob_i(\d+)', '%1$s_i\1', 'g'
        ),
        table_name
      );
    $$
    LANGUAGE sql IMMUTABLE;
  ;

    CREATE FUNCTION pgboss.job_table_run(command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    DECLARE
      tbl RECORD;
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        EXECUTE pgboss.job_table_format(command, tbl_name);
        RETURN;
      END IF;

      EXECUTE pgboss.job_table_format(command, 'job_common');

      FOR tbl IN SELECT table_name FROM pgboss.queue WHERE partition = true
      LOOP
        EXECUTE pgboss.job_table_format(command, tbl.table_name);
      END LOOP;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE FUNCTION pgboss.job_table_run_async(command_name text, version int, command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
        VALUES (
          command_name,
          version,
          'pending',
          queue_name,
          tbl_name,
          pgboss.job_table_format(command, tbl_name)
        );
        RETURN;
      END IF;

      INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
      SELECT
        command_name,
        version,
        'pending',
        NULL,
        'job_common',
        pgboss.job_table_format(command, 'job_common')
      UNION ALL
      SELECT
        command_name,
        version,
        'pending',
        queue.name,
        queue.table_name,
        pgboss.job_table_format(command, queue.table_name)
      FROM pgboss.queue
      WHERE partition = true;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE TABLE pgboss.job (
      id uuid not null default gen_random_uuid(),
      name text not null,
      priority integer not null default(0),
      data jsonb,
      state pgboss.job_state not null default 'created',
      retry_limit integer not null default 2,
      retry_count integer not null default 0,
      retry_delay integer not null default 0,
      retry_backoff boolean not null default false,
      retry_delay_max integer,
      expire_seconds int not null default 900,
      deletion_seconds int not null default 604800,
      singleton_key text,
      singleton_on timestamp without time zone,
      group_id text,
      group_tier text,
      start_after timestamp with time zone not null default now(),
      created_on timestamp with time zone not null default now(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone,
      keep_until timestamp with time zone NOT NULL default now() + interval '1209600',
      output jsonb,
      dead_letter text,
      policy text,
      heartbeat_on timestamp with time zone,
      heartbeat_seconds int,
      blocked boolean not null default false,
      blocking boolean not null default false,
      pending_dependencies int not null default 0,
      source_name text,
      source_id uuid,
      source_created_on timestamp with time zone,
      source_retry_count int,
      source_output jsonb,
      source_root_id uuid
    ) PARTITION BY LIST (name)
  ;
ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id);

    CREATE TABLE pgboss.job_common (LIKE pgboss.job INCLUDING GENERATED INCLUDING DEFAULTS);

    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i10 ON pgboss.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i11 ON pgboss.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i9 ON pgboss.job (name, id) WHERE blocking AND state = 'completed'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i12 ON pgboss.job (source_root_id) WHERE source_root_id IS NOT NULL$cmd$, 'job_common');

    ALTER TABLE pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT;
  ;

    CREATE TABLE pgboss.warning (
      id uuid PRIMARY KEY default gen_random_uuid(),
      type text NOT NULL,
      message text NOT NULL,
      data jsonb,
      created_on timestamp with time zone NOT NULL DEFAULT now()
    )
  ;
CREATE INDEX warning_i1 ON pgboss.warning (created_on DESC);

    CREATE TABLE pgboss.queue_stats (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      name text NOT NULL,
      deferred_count int NOT NULL DEFAULT 0,
      queued_count   int NOT NULL DEFAULT 0,
      ready_count    int NOT NULL DEFAULT 0,
      active_count   int NOT NULL DEFAULT 0,
      failed_count   int NOT NULL DEFAULT 0,
      total_count    int NOT NULL DEFAULT 0,
      created_delta   int,
      completed_delta int,
      failed_delta    int,
      delta_seconds   int,
      delta_on        timestamptz,
      captured_on timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id, captured_on)
    ) PARTITION BY RANGE (captured_on)
  ;
CREATE INDEX queue_stats_i1 ON pgboss.queue_stats (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);

    DO $$
    DECLARE
      d date;
      i int;
      part_name text;
    BEGIN
      FOR i IN 0..1 LOOP
        d := (pgboss.job_now() AT TIME ZONE 'UTC')::date + i;
        part_name := 'queue_stats_' || to_char(d, 'YYYYMMDD');
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'pgboss' AND c.relname = part_name
        ) THEN
          EXECUTE format(
            'CREATE TABLE pgboss.%I PARTITION OF pgboss.queue_stats FOR VALUES FROM (%L) TO (%L)',
            part_name,
            to_char(d, 'YYYY-MM-DD') || ' 00:00:00+00',
            to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00'
          );
        END IF;
      END LOOP;
    END;
    $$
  ;

    CREATE TABLE pgboss.job_dependency (
      child_name text NOT NULL,
      child_id uuid NOT NULL,
      parent_name text NOT NULL,
      parent_id uuid NOT NULL,
      PRIMARY KEY (child_name, child_id, parent_name, parent_id)
    )
  ;
CREATE INDEX IF NOT EXISTS job_dep_parent_idx ON pgboss.job_dependency (parent_name, parent_id);

    CREATE FUNCTION pgboss.create_queue(queue_name text, options jsonb)
    RETURNS VOID AS
    $$
    DECLARE
      tablename varchar := CASE WHEN options->>'partition' = 'true'
                            THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                            ELSE 'job_common'
                            END;
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
        INSERT INTO pgboss.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name,
          heartbeat_seconds,
          notify,
          created_on,
          updated_on
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename,
          (options->>'heartbeatSeconds')::int,
          COALESCE((options->>'notify')::bool, false),
          pgboss.job_now(),
          pgboss.job_now()
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', tablename);

      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i11 ON pgboss.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i9 ON pgboss.job (name, id) WHERE blocking AND state = 'completed'$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i12 ON pgboss.job (source_root_id) WHERE source_root_id IS NOT NULL$cmd$, tablename);

      IF options->>'policy' = 'short' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
      ELSIF options->>'policy' = 'singleton' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
      ELSIF options->>'policy' = 'stately' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
      ELSIF options->>'policy' = 'exclusive' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
      ELSIF options->>'policy' = 'key_strict_fifo' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i10 ON pgboss.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
      END IF;

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', tablename, queue_name);
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE FUNCTION pgboss.delete_queue(queue_name text)
    RETURNS VOID AS
    $$
    DECLARE
      v_table varchar;
      v_partition bool;
    BEGIN

      SELECT table_name, partition
      FROM pgboss.queue
      WHERE name = queue_name
      INTO v_table, v_partition;

      IF v_partition THEN
        EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);
      ELSE
        EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);
      END IF;

      DELETE FROM pgboss.queue WHERE name = queue_name;
    END;
    $$
    LANGUAGE plpgsql;
  ;
INSERT INTO pgboss.version(version) VALUES ('43');
-- pg-boss construction plan: end

-- The queue register. A queue is created in a migration, which registers it
-- here with its kind in the same migration; a dead-letter queue takes its
-- source's kind. Only migrator writes it, and its rows are never updated.
-- No tenant_id, and no created_by or updated_by: queues are platform
-- configuration that no person writes (ADR 0009).
CREATE TABLE app.job_queue (
  name text PRIMARY KEY REFERENCES pgboss.queue (name) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('tenant', 'platform')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.job_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY job_queue_select ON app.job_queue FOR SELECT
  TO app_api, app_worker, app_queue, migrator USING (true);
CREATE POLICY migrator_insert ON app.job_queue FOR INSERT TO migrator WITH CHECK (true);
CREATE POLICY migrator_delete ON app.job_queue FOR DELETE TO migrator USING (true);
SELECT app.deny_command('app.job_queue', 'INSERT');
SELECT app.deny_command('app.job_queue', 'UPDATE');
SELECT app.deny_command('app.job_queue', 'DELETE');
GRANT SELECT ON app.job_queue TO app_api, app_worker, app_queue;

-- ADR 0009's tenant checks, on every insert into and update of any job
-- table: PostgreSQL clones a row trigger on pgboss.job to each partition,
-- including a queue's own table when a later migration creates it. It runs
-- as the inserting role, never as a definer, and stays VOLATILE so each of
-- its queries takes a fresh snapshot and sees the failed source job that
-- pg-boss inserts earlier in the same statement (rule 5). A refusal raises
-- SQLSTATE JB001 and names the rule, never a value from the row.
CREATE FUNCTION app.check_job()
  RETURNS trigger
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  tenant uuid := app.current_tenant_id();
  from_queue boolean := current_user = 'app_queue';
  queue_kind text;
BEGIN
  -- Rule 6: an update cannot change a job's data, queue, singleton key or
  -- dead-letter queue.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.data, NEW.name, NEW.singleton_key, NEW.dead_letter)
       IS DISTINCT FROM (OLD.data, OLD.name, OLD.singleton_key, OLD.dead_letter) THEN
      RAISE EXCEPTION 'Job refused by ADR 0009 rule 6: an update cannot change data, name, singleton_key or dead_letter.'
        USING ERRCODE = 'JB001';
    END IF;
    RETURN NEW;
  END IF;

  -- Rule 1: the queue is registered.
  SELECT q.kind INTO queue_kind FROM app.job_queue AS q WHERE q.name = NEW.name;
  IF queue_kind IS NULL THEN
    RAISE EXCEPTION 'Job refused by ADR 0009 rule 1: its queue is not in app.job_queue.'
      USING ERRCODE = 'JB001';
  END IF;

  IF NEW.state = 'created' AND NEW.source_id IS NULL THEN
    -- Rule 2: a new tenant job carries the transaction's tenant.
    IF queue_kind = 'tenant' THEN
      IF tenant IS NULL OR (NEW.data ->> 'tenantId') IS DISTINCT FROM tenant::text THEN
        RAISE EXCEPTION 'Job refused by ADR 0009 rule 2: a new tenant job must carry the current tenant as tenantId.'
          USING ERRCODE = 'JB001';
      END IF;
    -- Rule 3: a new platform job carries no tenant and comes from app_queue.
    ELSIF NOT from_queue OR COALESCE(NEW.data ? 'tenantId', false) THEN
      RAISE EXCEPTION 'Job refused by ADR 0009 rule 3: a new platform job carries no tenantId and comes only from app_queue.'
        USING ERRCODE = 'JB001';
    END IF;
    -- Rules 2 and 3: a new job keeps its queue's dead-letter queue, so a
    -- send cannot point it at a queue of another kind, which rule 5 would
    -- then refuse inside pg-boss's batch fail and stall the queue.
    IF NEW.dead_letter IS DISTINCT FROM
       (SELECT q.dead_letter FROM pgboss.queue AS q WHERE q.name = NEW.name) THEN
      RAISE EXCEPTION 'Job refused by ADR 0009 rule %: a new job must keep its queue''s dead_letter.',
        CASE queue_kind WHEN 'tenant' THEN 2 ELSE 3 END
        USING ERRCODE = 'JB001';
    END IF;
  ELSIF NEW.state IN ('retry', 'failed') THEN
    -- Rule 4: pg-boss's fail and retry re-insert, from app_queue with no
    -- tenant set, keeping the tenant on a tenant queue.
    IF NOT from_queue OR tenant IS NOT NULL
       OR (queue_kind = 'tenant' AND (NEW.data ->> 'tenantId') IS NULL) THEN
      RAISE EXCEPTION 'Job refused by ADR 0009 rule 4: a retried or failed job comes only from app_queue with no tenant set, and keeps its tenantId.'
        USING ERRCODE = 'JB001';
    END IF;
  ELSIF NEW.state = 'created' THEN
    -- Rule 5: a dead-letter copy, from app_queue with no tenant set, of a
    -- failed job with the same data on a queue of the same kind.
    IF NOT from_queue OR tenant IS NOT NULL THEN
      RAISE EXCEPTION 'Job refused by ADR 0009 rule 5: a dead-letter copy comes only from app_queue with no tenant set.'
        USING ERRCODE = 'JB001';
    END IF;
    IF NOT EXISTS (
      SELECT FROM pgboss.job AS s
        JOIN app.job_queue AS q ON q.name = s.name
       WHERE s.name = NEW.source_name AND s.id = NEW.source_id AND s.state = 'failed'
         AND s.data IS NOT DISTINCT FROM NEW.data AND q.kind = queue_kind) THEN
      RAISE EXCEPTION 'Job refused by ADR 0009 rule 5: a dead-letter copy needs its failed source job, with the same data, on a queue of the same kind.'
        USING ERRCODE = 'JB001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Job refused by ADR 0009: an insert in state % matches none of rules 2 to 5.', NEW.state
      USING ERRCODE = 'JB001';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_job BEFORE INSERT OR UPDATE ON pgboss.job
  FOR EACH ROW EXECUTE FUNCTION app.check_job();

-- Reads every sender needs: the schema version pg-boss checks at start,
-- the queue settings each send joins, and event subscriptions for publish.
GRANT USAGE ON SCHEMA pgboss TO app_api, app_worker, app_queue;
GRANT EXECUTE ON FUNCTION pgboss.job_now() TO app_api, app_worker, app_queue;
GRANT SELECT ON pgboss.version, pgboss.queue, pgboss.subscription
   TO app_api, app_worker, app_queue;

-- app_api and app_worker only send: they insert exactly the columns
-- pg-boss's send writes and read back only the new id. A later queue's own
-- table gets the same grants in the migration that creates it.
GRANT INSERT (id, name, data, priority, start_after, created_on, singleton_key, singleton_on,
              group_id, group_tier, expire_seconds, deletion_seconds, keep_until, retry_limit,
              retry_delay, retry_backoff, retry_delay_max, policy, dead_letter,
              heartbeat_seconds, blocked, blocking, pending_dependencies),
      SELECT (id)
   ON pgboss.job, pgboss.job_common TO app_api, app_worker;

-- app_queue is pg-boss's own connection in the worker: it fetches,
-- completes, fails and retries jobs, runs maintenance (which also resolves
-- and clears job flow dependencies) and keeps the cron schedules. The
-- trigger refuses any insert of its that rules 2 to 5 do not allow.
GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.job, pgboss.job_common TO app_queue;
GRANT UPDATE ON pgboss.version, pgboss.queue TO app_queue;
GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.schedule TO app_queue;
GRANT SELECT, INSERT, DELETE ON pgboss.warning TO app_queue;
GRANT SELECT, DELETE ON pgboss.job_dependency TO app_queue;

-- The active tenants' ids, for the worker's per-tenant fan-out (ADR 0009,
-- "Processes and scheduling"), and nothing else about them. Handed to its
-- owner as ADR 0023 describes.
CREATE FUNCTION app.tenant_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT t.id FROM app.tenant AS t WHERE t.status = 'active' ORDER BY t.id;
END;

GRANT USAGE ON SCHEMA app TO owner_app_tenant_ids;
GRANT SELECT (id, status) ON app.tenant TO owner_app_tenant_ids;
CREATE POLICY tenant_ids_select ON app.tenant FOR SELECT TO owner_app_tenant_ids USING (true);

REVOKE ALL ON FUNCTION app.tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tenant_ids() TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_tenant_ids;
ALTER FUNCTION app.tenant_ids() OWNER TO owner_app_tenant_ids;
REVOKE CREATE ON SCHEMA app FROM owner_app_tenant_ids;
