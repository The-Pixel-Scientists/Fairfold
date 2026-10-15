-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0008, up: app.file, one row per uploaded file (ADR 0047,
-- "Records").
--
-- A row starts pending and moves once, to clean, infected or error, and a
-- final row never changes. Triggers set the scan state on insert and the
-- scan and creation times, so no grant names those columns. The storage key
-- and hash exist exactly when the file is clean, and the key can name only
-- this tenant's object for this row. app_api inserts the row and records
-- the verdict; nothing deletes one, which is the retention sweep's job.
-- The lists in the checks copy fileTypes, MAX_FILE_BYTES, scanStates and
-- fileNameSchema in packages/domain/src/files, and a test keeps them in step.

CREATE TABLE app.file (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT file_name_length CHECK (char_length(name) BETWEEN 1 AND 200)
    -- Control, format, line and paragraph separator characters, and both
    -- path separators.
    CONSTRAINT file_name_characters CHECK (name !~ '[\u0001-\u001f/\\\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]')
    -- Trimmed: no white space the domain's trim() removes at either end.
    CONSTRAINT file_name_trimmed CHECK (name !~ '^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'image/jpeg',
    'image/png')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 bytea CHECK (octet_length(sha256) = 32),
  storage_key text,
  scan_state text NOT NULL DEFAULT 'pending'
    CHECK (scan_state IN ('pending', 'clean', 'infected', 'error')),
  scanned_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT file_storage_key_own_object
    CHECK (storage_key = 'clean/' || tenant_id::text || '/' || id::text),
  CONSTRAINT file_scan_columns CHECK (CASE scan_state
    WHEN 'pending' THEN scanned_at IS NULL AND sha256 IS NULL AND storage_key IS NULL
    WHEN 'clean' THEN scanned_at IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL
    ELSE scanned_at IS NOT NULL AND sha256 IS NULL AND storage_key IS NULL
  END),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.file');
SELECT app.deny_command('app.file', 'DELETE');

-- Every new file is pending and unscanned, created now, whatever the insert
-- supplied.
CREATE FUNCTION app.start_file_scan()
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
CREATE TRIGGER start_file_scan BEFORE INSERT ON app.file
  FOR EACH ROW EXECUTE FUNCTION app.start_file_scan();

-- The one change a file allows: its verdict, with the hash and key when
-- clean, and the scan time set now. An update that leaves a pending row as
-- it was changes nothing.
CREATE FUNCTION app.record_file_scan()
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
CREATE TRIGGER record_file_scan BEFORE UPDATE ON app.file
  FOR EACH ROW EXECUTE FUNCTION app.record_file_scan();

GRANT SELECT,
      INSERT (tenant_id, id, name, content_type, size_bytes, created_by),
      UPDATE (scan_state, sha256, storage_key)
   ON app.file TO app_api;
