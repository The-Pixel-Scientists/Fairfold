-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0103, up: a signature request's signers (ADR 0040, S12-62).
--
-- A signer is a party.person, in a signing order unique per request; no
-- name or email address is stored, since the worker resolves them through
-- the party contract at send time, and no erased person is added. app_api
-- adds signers to a draft only; app_worker alone writes their status, and
-- the database sets the signing time. Nothing removes a signer. The status
-- list copies signerStatuses, and a test keeps them in step.

CREATE TABLE app.signature_signer (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id uuid NOT NULL,
  person_id uuid NOT NULL,
  signing_order smallint NOT NULL CHECK (signing_order BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'sent', 'viewed', 'signed', 'declined')),
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, signature_request_id, person_id),
  UNIQUE (tenant_id, signature_request_id, signing_order),
  CONSTRAINT signature_signer_signed CHECK ((status = 'signed') = (signed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, signature_request_id)
    REFERENCES app.signature_request (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, person_id) REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX signature_signer_person ON app.signature_signer (tenant_id, person_id);
SELECT app.enable_tenant_rls('app.signature_signer');
SELECT app.deny_command('app.signature_signer', 'DELETE');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF person_id ON app.signature_signer
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('person_id');

-- Only the status changes, and a signed or declined signer is final.
CREATE FUNCTION app.keep_signature_signer()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'waiting';
    NEW.signed_at := NULL;
    NEW.created_at := pg_catalog.now();
  ELSIF (NEW.tenant_id, NEW.id, NEW.signature_request_id, NEW.person_id, NEW.signing_order,
         NEW.created_at)
        IS DISTINCT FROM
        (OLD.tenant_id, OLD.id, OLD.signature_request_id, OLD.person_id, OLD.signing_order,
         OLD.created_at)
        OR (OLD.status IN ('signed', 'declined') AND NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'Only the status of a signer who has not signed or declined can change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  ELSE
    NEW.signed_at := CASE WHEN NEW.status <> 'signed' THEN NULL
                          WHEN OLD.status = 'signed' THEN OLD.signed_at
                          ELSE pg_catalog.now() END;
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_signature_signer BEFORE INSERT OR UPDATE ON app.signature_signer
  FOR EACH ROW EXECUTE FUNCTION app.keep_signature_signer();

-- After the row checks, so another tenant's insert is refused by its policy.
CREATE FUNCTION app.check_signature_signer()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM app.signature_request r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.signature_request_id AND r.status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signers are added to a draft signature request only.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_signature_signer AFTER INSERT ON app.signature_signer
  FOR EACH ROW EXECUTE FUNCTION app.check_signature_signer();

GRANT SELECT, INSERT (tenant_id, signature_request_id, person_id, signing_order)
   ON app.signature_signer TO app_api;
GRANT SELECT, UPDATE (status) ON app.signature_signer TO app_worker;
