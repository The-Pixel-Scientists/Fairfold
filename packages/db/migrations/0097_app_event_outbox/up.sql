-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0097, up: the event outbox and its per-tenant counter (ADR
-- 0034, S12-61). Consumer cursors and the relay's queues follow in 0098.
--
-- publish() writes one outbox row per event in the publisher's transaction.
-- The database sets its number, time and expiry, whatever the caller
-- supplies. No app role may update a row; app_worker alone deletes, and
-- only rows past their expiry. Publishing writes no audit event: the change
-- that published one already did. Every table is tenant-owned, and the relay
-- reads one tenant at a time inside its context: no definer function and no
-- policy here reads across tenants.

-- One event: ids, codes and times only (ADR 0027). caused_by is the
-- membership whose action caused it, null for the system.
CREATE TABLE app.event_outbox (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  type text NOT NULL CHECK (
    char_length(type) <= 200 AND type ~ '^[a-z]+\.[a-z][a-z_]*\.v[1-9][0-9]*$'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192),
  occurred_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  caused_by uuid,
  retain_until timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sequence),
  -- 90 days, counted in UTC so the session's time zone cannot shorten it.
  CONSTRAINT event_outbox_kept_90_days CHECK (
    retain_until >= ((occurred_at AT TIME ZONE 'UTC') + interval '90 days') AT TIME ZONE 'UTC'),
  FOREIGN KEY (tenant_id, caused_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX event_outbox_expiry ON app.event_outbox (tenant_id, retain_until);

-- The standard select and insert policies; the expired-row delete replaces
-- the standard delete policy, and nothing replaces the update policy.
SELECT app.enable_tenant_rls('app.event_outbox');
DROP POLICY tenant_update ON app.event_outbox;
DROP POLICY tenant_delete ON app.event_outbox;
CREATE POLICY deny_update ON app.event_outbox AS RESTRICTIVE FOR UPDATE
  TO app_api, app_worker, app_queue, app_auth, app_operator USING (false);
CREATE POLICY purge_delete ON app.event_outbox AS PERMISSIVE FOR DELETE TO app_worker
  USING (tenant_id = app.current_tenant_id() AND retain_until < now());
CREATE POLICY deny_delete ON app.event_outbox AS RESTRICTIVE FOR DELETE
  TO app_api, app_queue, app_auth, app_operator USING (false);

-- Each tenant's last event number. Only the numbering trigger writes it.
CREATE TABLE app.event_sequence (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  last_sequence bigint NOT NULL CHECK (last_sequence >= 1),
  UNIQUE (tenant_id, id)
);
SELECT app.enable_tenant_rls('app.event_sequence');
SELECT app.deny_command('app.event_sequence', 'DELETE');

-- A counter starts at 1 and only ever goes up by one, so no number is
-- reused. An update that changes nothing passes.
CREATE FUNCTION app.keep_event_sequence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.last_sequence <> 1)
     OR (TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD
         AND ((NEW.tenant_id, NEW.id) IS DISTINCT FROM (OLD.tenant_id, OLD.id)
              OR NEW.last_sequence <> OLD.last_sequence + 1)) THEN
    RAISE EXCEPTION 'A tenant''s event counter starts at 1 and only goes up by one.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_event_sequence BEFORE INSERT OR UPDATE ON app.event_sequence
  FOR EACH ROW EXECUTE FUNCTION app.keep_event_sequence();

-- Number an event from its tenant's counter, creating it at 1. The counter
-- row stays locked until the publishing transaction ends, so a tenant's
-- numbers follow commit order and a rollback gives its number back. Another
-- tenant's counter is never touched.
CREATE FUNCTION app.number_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM app.current_tenant_id() THEN
    RAISE EXCEPTION 'An event is written only in its own tenant.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.event_sequence AS s (tenant_id, last_sequence) VALUES (NEW.tenant_id, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET last_sequence = s.last_sequence + 1
    RETURNING s.last_sequence INTO NEW.sequence;
  RETURN NEW;
END
$function$;
CREATE TRIGGER number_event BEFORE INSERT ON app.event_outbox
  FOR EACH ROW EXECUTE FUNCTION app.number_event();

CREATE FUNCTION app.set_event_retention()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.occurred_at := pg_catalog.now();
  NEW.retain_until := ((NEW.occurred_at AT TIME ZONE 'UTC') + interval '90 days') AT TIME ZONE 'UTC';
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_event_retention BEFORE INSERT ON app.event_outbox
  FOR EACH ROW EXECUTE FUNCTION app.set_event_retention();

-- Any role that publishes writes the outbox through the numbering trigger,
-- and reads back the number and time; the relay (0098) reads it as
-- app_worker, which alone deletes expired events.
GRANT SELECT, INSERT (tenant_id, id, type, payload, request_id, caused_by)
   ON app.event_outbox TO app_api, app_worker;
GRANT DELETE ON app.event_outbox TO app_worker;
GRANT SELECT, INSERT (tenant_id, last_sequence), UPDATE (last_sequence)
   ON app.event_sequence TO app_api, app_worker;
