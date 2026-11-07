-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0041, down: app.file and app.request_limit as migrations 0008,
-- 0011 and 0017 left them.
--
-- It fails on 0008's checks while any file is withheld or erased: those
-- rows cannot go back, so the documented rollback is a restore from the
-- backup taken before 0041. The upload counters are removed with every
-- other counter (TRUNCATE is not bound by row-level security), which at
-- most lets each client start a fresh window.

TRUNCATE app.request_limit;
ALTER TABLE app.request_limit
  DROP CONSTRAINT request_limit_bucket_check,
  ADD CONSTRAINT request_limit_bucket_check CHECK (bucket IN ('public', 'probe', 'general')),
  ALTER COLUMN count TYPE integer;

REVOKE SELECT, UPDATE ON app.file FROM app_worker;
REVOKE UPDATE (scan_version, linked_at, released_at, updated_by) ON app.file FROM app_api;

CREATE OR REPLACE FUNCTION grants.check_application_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  link grants.application_file;
BEGIN
  IF TG_OP = 'DELETE' THEN
    link := OLD;
  ELSE
    link := NEW;
  END IF;
  PERFORM FROM grants.application a
    WHERE a.tenant_id = link.tenant_id AND a.id = link.application_id AND a.status = 'draft'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Files are added to or removed from a draft application only.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM FROM app.file f
      WHERE f.tenant_id = link.tenant_id AND f.id = link.file_id AND f.scan_state = 'clean';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only a file that has passed its virus scan can be linked.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  RETURN NULL;
END
$function$;

DROP FUNCTION app.link_file(uuid), app.release_file(uuid);

CREATE OR REPLACE FUNCTION app.record_file_scan()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.scan_state <> 'pending' THEN
    RAISE EXCEPTION 'File % has its final scan state already.', OLD.id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.name, NEW.content_type, NEW.size_bytes, NEW.created_by,
      NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.name, OLD.content_type, OLD.size_bytes, OLD.created_by,
      OLD.created_at) THEN
    RAISE EXCEPTION 'Only the scan state, hash and storage key of file % can change.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.scanned_at := CASE WHEN NEW.scan_state = 'pending' THEN NULL ELSE pg_catalog.now() END;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION app.start_file_scan()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.scan_state := 'pending';
  NEW.scanned_at := NULL;
  NEW.sha256 := NULL;
  NEW.storage_key := NULL;
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

DROP INDEX app.file_state;
ALTER TABLE app.file
  DROP CONSTRAINT file_scan_columns,
  DROP CONSTRAINT file_storage_key_own_object,
  DROP CONSTRAINT file_scan_state_check,
  DROP CONSTRAINT file_released_after_link,
  DROP CONSTRAINT file_updated_by_member,
  DROP COLUMN updated_by,
  DROP COLUMN updated_at,
  DROP COLUMN erased_at,
  DROP COLUMN released_at,
  DROP COLUMN linked_at,
  DROP COLUMN scan_version,
  ADD CONSTRAINT file_scan_state_check
    CHECK (scan_state IN ('pending', 'clean', 'infected', 'error')),
  ADD CONSTRAINT file_storage_key_own_object
    CHECK (storage_key = 'clean/' || tenant_id::text || '/' || id::text),
  ADD CONSTRAINT file_scan_columns CHECK (CASE scan_state
    WHEN 'pending' THEN scanned_at IS NULL AND sha256 IS NULL AND storage_key IS NULL
    WHEN 'clean' THEN scanned_at IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL
    ELSE scanned_at IS NOT NULL AND sha256 IS NULL AND storage_key IS NULL
  END);
