-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0098, up: consumer cursors over the event outbox, and the
-- relay's queues (ADR 0034, S12-61).
--
-- The relay reads one tenant at a time inside its context, as app_worker,
-- and moves each consumer's cursor only forward. A replay, as app_operator,
-- moves one back within the events still kept; it writes its own audit
-- event (S12-72). Ordinary cursor moves write none.

-- Each consumer's position in a tenant's events. A missing row starts before
-- the oldest event kept. A consumer code is added by the migration that adds
-- the consumer; probe is the relay's own, which receives every event and
-- does nothing with it.
CREATE TABLE app.event_cursor (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  consumer text NOT NULL CHECK (consumer IN ('probe')),
  last_sequence bigint NOT NULL CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consumer),
  UNIQUE (tenant_id, id)
);
SELECT app.enable_tenant_rls('app.event_cursor');
SELECT app.deny_command('app.event_cursor', 'DELETE');

-- The relay moves a cursor only forward, and never past the tenant's last
-- event. Only a replay, as app_operator, moves one back: never forward,
-- and never before the oldest event kept, which row-level security limits
-- to the cursor's own tenant.
CREATE FUNCTION app.keep_event_cursor()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  oldest bigint;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.tenant_id, NEW.id, NEW.consumer) IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.consumer) THEN
    RAISE EXCEPTION 'An event cursor keeps its tenant, id and consumer.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.updated_at := pg_catalog.now();
  IF TG_OP = 'UPDATE' AND current_user = 'app_operator' THEN
    IF NEW.last_sequence > OLD.last_sequence THEN
      RAISE EXCEPTION 'A replay moves an event cursor back, never forward.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF NEW.last_sequence < OLD.last_sequence THEN
      SELECT min(o.sequence) INTO oldest FROM app.event_outbox AS o
       WHERE o.retain_until > pg_catalog.now();
      IF oldest IS NULL OR NEW.last_sequence < oldest - 1 THEN
        RAISE EXCEPTION 'A replay starts no earlier than the oldest event kept.'
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
    END IF;
  ELSIF NEW.last_sequence > COALESCE(
          (SELECT s.last_sequence FROM app.event_sequence AS s WHERE s.tenant_id = NEW.tenant_id), 0)
        OR (TG_OP = 'UPDATE' AND NEW.last_sequence < OLD.last_sequence) THEN
    RAISE EXCEPTION 'An event cursor moves only forward, up to the last event.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_event_cursor BEFORE INSERT OR UPDATE ON app.event_cursor
  FOR EACH ROW EXECUTE FUNCTION app.keep_event_cursor();

-- The relay reads the outbox (0097) and moves cursors as app_worker; a
-- replay reads the oldest number kept and moves a cursor back as
-- app_operator. app_api has no cursor rights.
GRANT SELECT, INSERT (tenant_id, consumer, last_sequence), UPDATE (last_sequence, updated_at)
   ON app.event_cursor TO app_worker;
GRANT SELECT, UPDATE (last_sequence, updated_at) ON app.event_cursor TO app_operator;
GRANT SELECT (sequence, retain_until) ON app.event_outbox TO app_operator;

-- The relay's queues: the scheduled platform fan-out, the per-tenant relay
-- and one tenant queue per consumer code, each with a dead-letter queue of
-- its kind. Their jobs carry ids and codes only, which the existing
-- classification of pgboss.job covers.
SELECT pgboss.create_queue('platform.outbox_relay.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('platform.outbox_relay',
  '{"policy": "standard", "deadLetter": "platform.outbox_relay.dead"}');
SELECT pgboss.create_queue('platform.outbox_tenant.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('platform.outbox_tenant',
  '{"policy": "standard", "deadLetter": "platform.outbox_tenant.dead"}');
SELECT pgboss.create_queue('outbox.probe.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('outbox.probe',
  '{"policy": "standard", "deadLetter": "outbox.probe.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('platform.outbox_relay.dead', 'platform'), ('platform.outbox_relay', 'platform'),
         ('platform.outbox_tenant.dead', 'tenant'), ('platform.outbox_tenant', 'tenant'),
         ('outbox.probe.dead', 'tenant'), ('outbox.probe', 'tenant');
