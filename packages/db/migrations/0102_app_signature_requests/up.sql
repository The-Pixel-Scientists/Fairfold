-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0102, up: signature requests and their queues (ADR 0040,
-- S12-62).
--
-- A request asks for signatures on one sent file. app_api inserts it as a
-- draft; its status, error code and provider reference are written by
-- app_worker alone, and nothing deletes one. The triggers set the database's
-- values whatever an insert supplied, allow exactly the moves of canMoveTo()
-- in packages/domain/src/documents/esign.ts, and refuse every change once a
-- status is final; a test keeps the lists in step. No trigger reaches outside
-- these tables: a signed, declined, expired or failed request never changes
-- an application, award or decision (rules 8 and 9).

CREATE TABLE app.signature_request (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled', 'failed')),
  error_code text CHECK (error_code IN (
    'signature.signer_unavailable', 'signature.upload_mismatch', 'signature.document_mismatch',
    'signature.provider_unavailable')),
  -- The provider's envelope reference, which the platform never parses.
  provider_reference text CHECK (provider_reference ~ '^[!-~]{1,200}$'),
  sent_sha256 bytea NOT NULL CHECK (octet_length(sent_sha256) = 32),
  template_version_id uuid,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connection_id, provider_reference),
  CONSTRAINT signature_request_error CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  -- A draft has no envelope; a request cancelled or failed as a draft never had one.
  CONSTRAINT signature_request_reference CHECK (CASE status
    WHEN 'draft' THEN provider_reference IS NULL
    WHEN 'cancelled' THEN true
    WHEN 'failed' THEN true
    ELSE provider_reference IS NOT NULL END),
  -- MAX_EXPIRY_DAYS, counted in hours so no time zone change moves it.
  CONSTRAINT signature_request_expiry
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '2160 hours'),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES app.signature_connection (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES app.document_template_version (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX signature_request_open ON app.signature_request (tenant_id, status)
  WHERE status IN ('draft', 'sent', 'viewed');
SELECT app.enable_tenant_rls('app.signature_request');
SELECT app.deny_command('app.signature_request', 'DELETE');

CREATE FUNCTION app.keep_signature_request()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    NEW.error_code := NULL;
    NEW.provider_reference := NULL;
    NEW.created_at := pg_catalog.now();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.connection_id, NEW.sent_sha256, NEW.template_version_id,
      NEW.expires_at, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.connection_id, OLD.sent_sha256, OLD.template_version_id,
      OLD.expires_at, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Only the status, error code and provider reference of a signature request can change.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.status, NEW.error_code, NEW.provider_reference)
     IS NOT DISTINCT FROM (OLD.status, OLD.error_code, OLD.provider_reference) THEN
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('draft', 'sent', 'viewed')
     OR (NEW.status <> OLD.status AND NOT CASE OLD.status
           WHEN 'draft' THEN NEW.status IN ('sent', 'cancelled', 'failed')
           WHEN 'sent' THEN NEW.status IN ('viewed', 'signed', 'declined', 'expired', 'cancelled',
                                           'failed')
           WHEN 'viewed' THEN NEW.status IN ('signed', 'declined', 'expired', 'cancelled', 'failed')
         END)
     OR (OLD.provider_reference IS NOT NULL
         AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference) THEN
    RAISE EXCEPTION 'A signature request cannot move from % to %, and its provider reference is set once.',
      OLD.status, NEW.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_signature_request BEFORE INSERT OR UPDATE ON app.signature_request
  FOR EACH ROW EXECUTE FUNCTION app.keep_signature_request();

GRANT SELECT,
      INSERT (tenant_id, id, connection_id, sent_sha256, template_version_id, expires_at,
              created_by)
   ON app.signature_request TO app_api;
GRANT SELECT, UPDATE (status, error_code, provider_reference)
   ON app.signature_request TO app_worker;

-- One waiting job per request on each (see 0045).
SELECT pgboss.create_queue('platform.signature_send.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('platform.signature_send',
  '{"policy": "exclusive", "deadLetter": "platform.signature_send.dead"}');
SELECT pgboss.create_queue('platform.signature_refresh.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('platform.signature_refresh',
  '{"policy": "exclusive", "deadLetter": "platform.signature_refresh.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('platform.signature_send.dead', 'tenant'), ('platform.signature_send', 'tenant'),
         ('platform.signature_refresh.dead', 'tenant'), ('platform.signature_refresh', 'tenant');
