-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0104, up: a signature request's files (ADR 0040, S12-62).
--
-- Files reach a request through a join table, one row per role, with
-- ADR 0030's link triggers (one file, one link, only once clean). app_api
-- links the file sent, a PDF whose SHA-256 its draft request records;
-- app_worker links the signed file, also a PDF, and the evidence. A deferred
-- check holds that a request is signed exactly when it has both. Nothing
-- removes a link.

CREATE TABLE app.signature_request_file (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('sent', 'signed', 'evidence')),
  file_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, signature_request_id, role),
  UNIQUE (tenant_id, file_id),
  FOREIGN KEY (tenant_id, signature_request_id)
    REFERENCES app.signature_request (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.signature_request_file');
SELECT app.deny_command('app.signature_request_file', 'UPDATE');
SELECT app.deny_command('app.signature_request_file', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.signature_request_file
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE POLICY api_sent_insert ON app.signature_request_file AS RESTRICTIVE FOR INSERT
  TO app_api WITH CHECK (role = 'sent');
CREATE POLICY worker_result_insert ON app.signature_request_file AS RESTRICTIVE FOR INSERT
  TO app_worker WITH CHECK (role IN ('signed', 'evidence'));

CREATE FUNCTION app.link_signature_request_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM app.signature_request r
    JOIN app.file f ON f.tenant_id = r.tenant_id AND f.id = NEW.file_id
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.signature_request_id
     AND (NEW.role = 'evidence' OR f.content_type = 'application/pdf')
     AND (NEW.role <> 'sent' OR (r.status = 'draft' AND f.sha256 = r.sent_sha256));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sent or signed file is a PDF, and a sent file joins a draft request that records its SHA-256.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM app.link_file(NEW.file_id);
  RETURN NULL;
END
$function$;
CREATE TRIGGER link_signature_request_file AFTER INSERT ON app.signature_request_file
  FOR EACH ROW EXECUTE FUNCTION app.link_signature_request_file();

-- At commit, so the worker links both files and moves the request in one
-- transaction. The argument names the column that holds the request's id.
CREATE FUNCTION app.check_signature_request_files()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  request_id CONSTANT uuid := (pg_catalog.to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  PERFORM FROM app.signature_request r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = request_id
     AND (SELECT pg_catalog.count(*) FROM app.signature_request_file l
           WHERE l.tenant_id = r.tenant_id AND l.signature_request_id = r.id AND l.role <> 'sent')
         = CASE r.status WHEN 'signed' THEN 2 ELSE 0 END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A signature request has a signed file and evidence exactly when it is signed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$function$;
CREATE CONSTRAINT TRIGGER check_signature_request_files
  AFTER INSERT OR UPDATE OF status ON app.signature_request
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_signature_request_files('id');
CREATE CONSTRAINT TRIGGER check_signature_request_files
  AFTER INSERT ON app.signature_request_file
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_signature_request_files('signature_request_id');

GRANT SELECT, INSERT (tenant_id, signature_request_id, role, file_id)
   ON app.signature_request_file TO app_api, app_worker;
-- The worker's links run app.link_file() as the worker (migration 0041).
GRANT EXECUTE ON FUNCTION app.link_file(uuid) TO app_worker;
GRANT UPDATE (linked_at) ON app.file TO app_worker;
