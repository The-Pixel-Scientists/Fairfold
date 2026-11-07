-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0017, up: idempotency keys and the request-limit store
-- (ADR 0028, S11-31).
--
-- The database sets every expiry, whatever the caller supplies. Only
-- app_worker deletes, only rows past their expiry, and only through a
-- bounded delete. Neither a key nor a counter writes an audit event: the
-- create a key guards is the audited change.

-- One key a member sent to an idempotent route in a tenant: the SHA-256 of
-- the canonical request and, once the handler has run in the same
-- transaction, the status it answered and the id of the resource its
-- response reads. No request or response value is kept. created_id is not a
-- foreign key, since that resource lives in a different table for each
-- route; a replay reads it afresh through the route's audience projection.
-- Row-level security separates tenants, not members: the unique key, and
-- every lookup naming the session's membership, keep members apart. Route
-- ids are the contract's method and path template, and only a signed-in
-- POST route is idempotent.
CREATE TABLE app.idempotency_key (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL,
  route_id text NOT NULL CHECK (
    char_length(route_id) <= 200
    AND route_id ~ '^POST /(console|portal)(/([a-z0-9]+([-.][a-z0-9]+)*|:[a-z][A-Za-z0-9]*))+$'),
  key uuid NOT NULL CHECK (
    substr(key::text, 15, 1) IN ('4', '7') AND substr(key::text, 20, 1) IN ('8', '9', 'a', 'b')),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  state text NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed')),
  status smallint CHECK (status BETWEEN 200 AND 299),
  created_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, membership_id, route_id, key),
  CONSTRAINT idempotency_key_state CHECK (
    (state = 'in_progress' AND status IS NULL AND created_id IS NULL)
    OR (state = 'completed' AND status IS NOT NULL)),
  CONSTRAINT idempotency_key_lasts_24_hours CHECK (expires_at = created_at + interval '24 hours'),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX idempotency_key_expiry ON app.idempotency_key (tenant_id, expires_at);

SELECT app.enable_tenant_rls('app.idempotency_key');
-- The purge's policies replace the standard delete policy: app_worker alone
-- deletes, and sees, only its tenant's expired keys.
DROP POLICY tenant_delete ON app.idempotency_key;
CREATE POLICY purge_delete ON app.idempotency_key AS PERMISSIVE FOR DELETE TO app_worker
  USING (tenant_id = app.current_tenant_id() AND expires_at < now());
CREATE POLICY purge_select ON app.idempotency_key AS RESTRICTIVE FOR SELECT TO app_worker
  USING (expires_at < now());
CREATE POLICY deny_delete ON app.idempotency_key AS RESTRICTIVE FOR DELETE
  TO app_api, app_queue, app_auth USING (false);

CREATE FUNCTION app.set_idempotency_key_expiry()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.created_at := pg_catalog.now();
  NEW.expires_at := NEW.created_at + interval '24 hours';
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_idempotency_key_expiry BEFORE INSERT ON app.idempotency_key
  FOR EACH ROW EXECUTE FUNCTION app.set_idempotency_key_expiry();

-- A key changes once, from in_progress to completed, and nothing else about
-- it ever changes. An update that changes nothing passes.
CREATE FUNCTION app.keep_idempotency_key()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW IS DISTINCT FROM OLD AND NOT (
       OLD.state = 'in_progress' AND NEW.state = 'completed'
       AND (NEW.tenant_id, NEW.id, NEW.membership_id, NEW.route_id, NEW.key, NEW.request_hash,
            NEW.created_at, NEW.expires_at)
           IS NOT DISTINCT FROM
           (OLD.tenant_id, OLD.id, OLD.membership_id, OLD.route_id, OLD.key, OLD.request_hash,
            OLD.created_at, OLD.expires_at)) THEN
    RAISE EXCEPTION 'Idempotency key % only changes from in progress to completed.', OLD.id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_idempotency_key BEFORE UPDATE ON app.idempotency_key
  FOR EACH ROW EXECUTE FUNCTION app.keep_idempotency_key();

-- app_api reserves a key, which starts in progress, and completes it.
GRANT SELECT,
      INSERT (tenant_id, membership_id, route_id, key, request_hash),
      UPDATE (state, status, created_id)
   ON app.idempotency_key TO app_api;
GRANT SELECT (tenant_id, id, expires_at), DELETE ON app.idempotency_key TO app_worker;

-- The counters behind the API's rate limits, shared by every API instance.
-- Not tenant-owned: a counter belongs to a client, not a tenant, and holds
-- nothing a tenant entered. key_hash is an HMAC-SHA-256 of the bucket and
-- the client key under a server key; never an address, session id,
-- identifier or email address in clear. Nothing else may be stored here.
CREATE TABLE app.request_limit (
  bucket text NOT NULL CHECK (bucket IN ('public', 'probe', 'general')),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (bucket, key_hash, window_start),
  CONSTRAINT request_limit_lasts_24_hours CHECK (expires_at = window_start + interval '24 hours')
);
CREATE INDEX request_limit_expiry ON app.request_limit (expires_at);

ALTER TABLE app.request_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.request_limit FORCE ROW LEVEL SECURITY;
CREATE POLICY api_select ON app.request_limit AS PERMISSIVE FOR SELECT TO app_api
  USING (true);
CREATE POLICY api_insert ON app.request_limit AS PERMISSIVE FOR INSERT TO app_api
  WITH CHECK (true);
CREATE POLICY api_update ON app.request_limit AS PERMISSIVE FOR UPDATE TO app_api
  USING (true) WITH CHECK (true);
CREATE POLICY purge_select ON app.request_limit AS PERMISSIVE FOR SELECT TO app_worker
  USING (expires_at < now());
CREATE POLICY purge_delete ON app.request_limit AS PERMISSIVE FOR DELETE TO app_worker
  USING (expires_at < now());
CREATE POLICY deny_delete ON app.request_limit AS RESTRICTIVE FOR DELETE
  TO app_api, app_queue, app_auth USING (false);

CREATE FUNCTION app.set_request_limit_expiry()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.expires_at := NEW.window_start + interval '24 hours';
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_request_limit_expiry BEFORE INSERT OR UPDATE ON app.request_limit
  FOR EACH ROW EXECUTE FUNCTION app.set_request_limit_expiry();

-- app_api upserts a counter; it changes only the count.
GRANT SELECT, INSERT (bucket, key_hash, window_start, count), UPDATE (count)
   ON app.request_limit TO app_api;
GRANT SELECT (bucket, key_hash, window_start, expires_at), DELETE
   ON app.request_limit TO app_worker;

-- The purges, run by app_worker until they return 0: each deletes at most
-- max_rows expired rows that row-level security lets it reach (for keys,
-- only the current tenant's) and returns how many.
CREATE FUNCTION app.delete_expired_idempotency_keys(max_rows integer)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  deleted integer;
BEGIN
  IF max_rows IS NULL OR max_rows NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'max_rows must be from 1 to 10000.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM app.idempotency_key
   WHERE id IN (SELECT k.id FROM app.idempotency_key k
                 WHERE k.tenant_id = app.current_tenant_id() AND k.expires_at < pg_catalog.now()
                 LIMIT max_rows);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$function$;

CREATE FUNCTION app.delete_expired_request_limits(max_rows integer)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  deleted integer;
BEGIN
  IF max_rows IS NULL OR max_rows NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'max_rows must be from 1 to 10000.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM app.request_limit
   WHERE (bucket, key_hash, window_start) IN (
     SELECT l.bucket, l.key_hash, l.window_start FROM app.request_limit l
      WHERE l.expires_at < pg_catalog.now()
      LIMIT max_rows);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$function$;

REVOKE EXECUTE ON FUNCTION app.delete_expired_idempotency_keys(integer),
  app.delete_expired_request_limits(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_expired_idempotency_keys(integer),
  app.delete_expired_request_limits(integer) TO app_worker;
