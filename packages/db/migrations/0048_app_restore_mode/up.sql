-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0048, up: restore mode, and the erasure ledger's second writer
-- (ADR 0027 and ADR 0011, "Erasure and restores"; S11-109).
--
-- Restore mode is one row of the cell, so it has no tenant_id. The restore
-- command alone, connected as migrator until the roles script has a restore
-- role, sets it, as its first write to a restored database, and clears it.
-- No app role can write it. The API and the worker may read it, and hold
-- back while it is set (ADR 0011); until they do, the restore command holds
-- them at zero instances itself. request_id is the restore's own: it ties
-- every re-apply event to this restore. created_by and updated_by stay null:
-- the operator is no member, and the restore record names them (ADR 0011).
--
-- app.restore_erasure_ledger_row() puts back one row an operator has
-- confirmed from an off-site copy (ADR 0027, "Copies are not trusted on
-- their own"), which a dump older than the erasure does not hold. It keeps
-- the row's own ids and time, and runs with the caller's rights: only
-- migrator holds them, and only the restore command connects as migrator.
-- Rights and policies are listed in test/catalogue.

CREATE TABLE app.restore_mode (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  active boolean NOT NULL DEFAULT false,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT restore_mode_request CHECK (active = (request_id IS NOT NULL))
);
ALTER TABLE app.restore_mode ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.restore_mode FORCE ROW LEVEL SECURITY;
CREATE POLICY restore_mode_select ON app.restore_mode FOR SELECT
  TO app_api, app_worker, migrator, owner_party_erase_party, owner_app_destroy_subject_key,
     owner_app_reapply_erasure_ledger
  USING (true);
CREATE POLICY migrator_insert ON app.restore_mode FOR INSERT TO migrator WITH CHECK (true);
CREATE POLICY migrator_update ON app.restore_mode FOR UPDATE TO migrator
  USING (true) WITH CHECK (true);
SELECT app.deny_command('app.restore_mode', 'INSERT');
SELECT app.deny_command('app.restore_mode', 'UPDATE');
SELECT app.deny_command('app.restore_mode', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.restore_mode
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.restore_mode TO app_api, app_worker;
INSERT INTO app.restore_mode DEFAULT VALUES;

CREATE FUNCTION app.restore_erasure_ledger_row(
    row_id uuid, subject_party_id uuid, kind text, subject_key_id uuid, audit_event_id uuid,
    erased_at timestamptz)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  restore_tenant CONSTANT uuid := app.current_tenant_id();
  restore_request uuid;
  inserted uuid;
BEGIN
  IF restore_tenant IS NULL THEN
    RAISE EXCEPTION 'Restoring an erasure ledger row needs a tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT m.request_id INTO restore_request FROM app.restore_mode m WHERE m.active;
  IF restore_request IS NULL THEN
    RAISE EXCEPTION 'An erasure ledger row is restored only in restore mode.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF restore_erasure_ledger_row.erased_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'An erasure ledger row cannot be erased in the future.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO app.erasure_ledger (tenant_id, id, subject_party_id, kind, subject_key_id,
                                  audit_event_id, erased_at)
  VALUES (restore_tenant, row_id, restore_erasure_ledger_row.subject_party_id,
          restore_erasure_ledger_row.kind, restore_erasure_ledger_row.subject_key_id,
          restore_erasure_ledger_row.audit_event_id, restore_erasure_ledger_row.erased_at)
  ON CONFLICT DO NOTHING
  RETURNING id INTO inserted;
  IF inserted IS NULL THEN
    RETURN false;
  END IF;
  -- The party may be absent from the restored data, so its id goes in the
  -- changes, not the subject column's foreign key.
  INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
                               changes)
  VALUES (restore_tenant, restore_request, 'operator', 'platform.erasure_ledger.row_restored',
          'platform.erasure_ledger', row_id,
          pg_catalog.jsonb_build_object('subjectPartyId', restore_erasure_ledger_row.subject_party_id,
                                        'kind', restore_erasure_ledger_row.kind,
                                        'subjectKeyId', restore_erasure_ledger_row.subject_key_id,
                                        'auditEventId', restore_erasure_ledger_row.audit_event_id));
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION app.restore_erasure_ledger_row(uuid, uuid, text, uuid, uuid, timestamptz)
  FROM PUBLIC;
