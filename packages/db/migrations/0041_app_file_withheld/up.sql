-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0041, up: withheld files, link times and upload counters
-- (ADR 0030, S11-74).
--
-- app.file gains the withheld state, the signature version of each scan,
-- the link, release and erasure times, and who and when it last changed.
-- The trigger allows only ADR 0030's changes: a clean file records later
-- scans or is withheld (app_api, at download); a withheld file records
-- later scans or is restored (app_worker, the withheld recheck), or moves
-- to infected (app_api, a staff deletion). The hash never changes once
-- set. A file is linked once, when clean, and released once. Setting the
-- erasure time clears the name, hash and key, and the row then changes no
-- more but for its release. No role here may set it: 0042's erasure
-- function does.
--
-- Rows linked before this migration have no link time; releasing one sets
-- it from the upload time, when ADR 0047 linked every file.
--
-- app.request_limit gains the four upload buckets, and its count becomes
-- bigint, since two buckets count bytes (amending ADR 0028).

ALTER TABLE app.file
  ADD COLUMN scan_version integer CONSTRAINT file_scan_version_check CHECK (scan_version > 0),
  ADD COLUMN linked_at timestamptz,
  ADD COLUMN released_at timestamptz,
  ADD COLUMN erased_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by uuid,
  ADD CONSTRAINT file_updated_by_member FOREIGN KEY (tenant_id, updated_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT file_released_after_link CHECK (released_at IS NULL OR linked_at IS NOT NULL),
  DROP CONSTRAINT file_scan_state_check,
  ADD CONSTRAINT file_scan_state_check
    CHECK (scan_state IN ('pending', 'clean', 'withheld', 'infected', 'error')),
  DROP CONSTRAINT file_storage_key_own_object,
  ADD CONSTRAINT file_storage_key_own_object CHECK (storage_key =
    CASE scan_state WHEN 'withheld' THEN 'withheld/' ELSE 'clean/' END
      || tenant_id::text || '/' || id::text),
  DROP CONSTRAINT file_scan_columns,
  ADD CONSTRAINT file_scan_columns CHECK (CASE
    WHEN erased_at IS NOT NULL THEN
      sha256 IS NULL AND storage_key IS NULL AND scan_state <> 'withheld'
    WHEN scan_state = 'pending' THEN
      scanned_at IS NULL AND sha256 IS NULL AND storage_key IS NULL AND scan_version IS NULL
    WHEN scan_state = 'clean' THEN
      scanned_at IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL
    WHEN scan_state = 'withheld' THEN
      scanned_at IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL
      AND scan_version IS NOT NULL
    ELSE scanned_at IS NOT NULL AND sha256 IS NULL AND storage_key IS NULL
  END);
CREATE INDEX file_state ON app.file (tenant_id, scan_state);

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
  NEW.scan_version := NULL;
  NEW.linked_at := NULL;
  NEW.released_at := NULL;
  NEW.erased_at := NULL;
  NEW.created_at := pg_catalog.now();
  NEW.updated_at := NEW.created_at;
  NEW.updated_by := NEW.created_by;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION app.record_file_scan()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  change CONSTANT text[] := ARRAY[OLD.scan_state, NEW.scan_state];
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.content_type, NEW.size_bytes, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.content_type, OLD.size_bytes, OLD.created_by, OLD.created_at)
     OR (NEW.name IS DISTINCT FROM OLD.name AND OLD.erased_at IS NULL AND NEW.erased_at IS NULL)
  THEN
    RAISE EXCEPTION 'Only the scan, link and erasure columns of file % can change.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.erased_at IS NOT NULL OR NEW.erased_at IS NOT NULL THEN
    -- Erased, or being erased: only the erasure time, then only the
    -- release time once, may be set.
    IF (NEW.name, NEW.sha256, NEW.storage_key, NEW.scan_state, NEW.scanned_at,
        NEW.scan_version, NEW.linked_at, NEW.erased_at)
       IS DISTINCT FROM
       (OLD.name, OLD.sha256, OLD.storage_key, OLD.scan_state, OLD.scanned_at,
        OLD.scan_version, OLD.linked_at, COALESCE(OLD.erased_at, NEW.erased_at))
       OR (NEW.released_at IS DISTINCT FROM OLD.released_at
           AND (OLD.released_at IS NOT NULL OR OLD.erased_at IS NULL)) THEN
      RAISE EXCEPTION 'File % is erased: only its release time can be set, once.', OLD.id
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF OLD.erased_at IS NULL THEN
      NEW.erased_at := pg_catalog.now();
      NEW.name := 'Erased file';
      NEW.sha256 := NULL;
      NEW.storage_key := NULL;
      IF OLD.scan_state = 'withheld' THEN
        NEW.scan_state := 'infected';
      END IF;
    END IF;
  ELSE
    IF (NEW.scan_state, NEW.sha256, NEW.storage_key, NEW.scan_version)
       IS DISTINCT FROM (OLD.scan_state, OLD.sha256, OLD.storage_key, OLD.scan_version) THEN
      IF NOT (
           (OLD.scan_state = 'pending' AND NEW.scan_state <> 'withheld'
            AND current_user <> 'app_worker')
           OR (change = ARRAY['clean', 'clean'] AND current_user <> 'app_worker')
           OR (change = ARRAY['clean', 'withheld'] AND current_user <> 'app_worker')
           OR change = ARRAY['withheld', 'withheld']
           OR (change = ARRAY['withheld', 'clean'] AND current_user = 'app_worker')
           OR (change = ARRAY['withheld', 'infected'] AND current_user <> 'app_worker'))
         OR (OLD.scan_state <> 'pending' AND NEW.scan_state <> 'infected'
             AND NEW.sha256 IS DISTINCT FROM OLD.sha256) THEN
        RAISE EXCEPTION 'File % cannot change from % to % here.', OLD.id, OLD.scan_state,
          NEW.scan_state
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
      NEW.scanned_at := CASE
        WHEN NEW.scan_state = 'pending' THEN NULL
        WHEN change = ARRAY['withheld', 'infected'] THEN OLD.scanned_at
        ELSE pg_catalog.now()
      END;
    ELSE
      NEW.scanned_at := OLD.scanned_at;
    END IF;
    IF NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
      IF OLD.linked_at IS NOT NULL OR NEW.linked_at IS NULL OR OLD.scan_state <> 'clean' THEN
        RAISE EXCEPTION 'File % is linked once, and only while clean.', OLD.id
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
      NEW.linked_at := pg_catalog.now();
    END IF;
    IF NEW.released_at IS DISTINCT FROM OLD.released_at
       AND (OLD.released_at IS NOT NULL OR NEW.released_at IS NULL) THEN
      RAISE EXCEPTION 'File % is released once.', OLD.id
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  IF (NEW.linked_at, NEW.released_at) IS DISTINCT FROM (OLD.linked_at, OLD.released_at) THEN
    -- Only through app.link_file() and app.release_file(), from a join
    -- table's trigger.
    IF pg_catalog.pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'File % is linked and released only by a link''s triggers.', OLD.id
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF NEW.released_at IS DISTINCT FROM OLD.released_at THEN
      NEW.released_at := pg_catalog.now();
      NEW.linked_at := COALESCE(NEW.linked_at, OLD.created_at);
    END IF;
  END IF;
  NEW.updated_at := pg_catalog.now();
  IF current_user <> 'app_api' THEN
    NEW.updated_by := NULL;
  END IF;
  RETURN NEW;
END
$function$;

-- Every join table's triggers link a file when its link is added and
-- release it when the link is removed (ADR 0030, "One file, one link").
-- They run as the caller, under its row-level security.
CREATE FUNCTION app.link_file(file_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  UPDATE app.file f SET linked_at = pg_catalog.now()
   WHERE f.tenant_id = app.current_tenant_id() AND f.id = link_file.file_id
     AND f.scan_state = 'clean' AND f.linked_at IS NULL AND f.erased_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a file that has passed its virus scan, and was never linked, can be linked.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END
$function$;

CREATE FUNCTION app.release_file(file_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  UPDATE app.file f SET released_at = pg_catalog.now()
   WHERE f.tenant_id = app.current_tenant_id() AND f.id = release_file.file_id
     AND f.released_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a linked file can be released, once.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END
$function$;

-- As migration 0011, with the link and release recorded on the file.
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
    PERFORM app.link_file(link.file_id);
  ELSE
    PERFORM app.release_file(link.file_id);
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION app.link_file(uuid), app.release_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.link_file(uuid), app.release_file(uuid) TO app_api;

-- app_api records verdicts and rescans, withholds, deletes withheld files
-- for staff, and links and releases files. app_worker reads what the sweep
-- and the withheld recheck need, never the name, and restores.
GRANT UPDATE (scan_version, linked_at, released_at, updated_by) ON app.file TO app_api;
GRANT SELECT (tenant_id, id, content_type, size_bytes, sha256, storage_key, scan_state,
              scanned_at, scan_version, linked_at, released_at, erased_at),
      UPDATE (scan_state, storage_key, scan_version)
   ON app.file TO app_worker;

ALTER TABLE app.request_limit
  ALTER COLUMN count TYPE bigint,
  DROP CONSTRAINT request_limit_bucket_check,
  ADD CONSTRAINT request_limit_bucket_check CHECK (bucket IN (
    'public', 'probe', 'general',
    'upload_files_membership', 'upload_bytes_membership',
    'upload_files_address', 'upload_bytes_address'));
