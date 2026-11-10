-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0047, up: the erasure ledger (ADR 0027, "Backups and restores";
-- S11-109). One row, of ids, codes and times only, for each party erased and
-- each subject key destroyed, written by the database in the erasure's own
-- transaction, so a restore can tell who must be erased again.
--
-- This migration builds the ledger and its writer. Migrations 0048 and 0049
-- add restore mode and app.reapply_erasure_ledger(), which erases the listed
-- parties again in a restored database before it takes traffic.
--
-- The ids are plain uuids, the named exception to rule 3 (ADR 0027): after a
-- restore the ledger must keep rows whose party the restored data lacks, so
-- they reach every later backup, and a row outlives its audit event, which
-- the 12-month purge must stay free to delete.
--
-- Each row comes from a trigger on the erasure's own audit event, because
-- party.erase_party and app.destroy_subject_key write that event after the
-- change it records and must stay as they are. An app role can insert an
-- event with one of these actions, so the trigger also names the owner of
-- the function that writes it: forging an event writes no ledger row.
-- Erasing an erased party writes no event, so no row either. ON CONFLICT
-- leaves a row already there, as a restored ledger can hold one for a party
-- that is erased again.
--
-- The backup's copy needs no new function. The backup role already reads
-- every tenant's rows, under its row-security exemption (ADR 0011), and a
-- plain SELECT of this table is the smaller design:
--
--   SELECT tenant_id, id, subject_party_id, kind, subject_key_id,
--          audit_event_id, erased_at
--     FROM app.erasure_ledger
--    ORDER BY tenant_id, erased_at, id;
--
-- Ledger file, format version 1: one JSON object, encrypted like every other
-- snapshot object, named in the manifest and kept on the snapshot's tier.
--
--   { "formatVersion": 1,
--     "entries": [ { "tenantId": uuid, "id": uuid, "subjectPartyId": uuid,
--                    "kind": "party_erased" | "subject_key_destroyed",
--                    "subjectKeyId": uuid | null, "auditEventId": uuid,
--                    "erasedAt": ISO 8601 in UTC } ] }
--
-- Entries are in the query's order. Rights and policies are listed in
-- test/catalogue.

CREATE TABLE app.erasure_ledger (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_party_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('party_erased', 'subject_key_destroyed')),
  subject_key_id uuid,
  audit_event_id uuid NOT NULL,
  -- No writer has INSERT on either: the database sets both. Counted in UTC
  -- so the session's time zone cannot move the date.
  erased_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL GENERATED ALWAYS AS (
    ((erased_at AT TIME ZONE 'UTC') + interval '7 years') AT TIME ZONE 'UTC') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, subject_party_id, kind),
  CONSTRAINT erasure_ledger_subject_key
    CHECK ((kind = 'subject_key_destroyed') = (subject_key_id IS NOT NULL))
);

-- Append-only: no app role writes a row. app_worker reads, to copy new rows
-- off-site (ADR 0027).
SELECT app.enable_tenant_rls('app.erasure_ledger');
SELECT app.deny_command('app.erasure_ledger', 'INSERT');
SELECT app.deny_command('app.erasure_ledger', 'UPDATE');
SELECT app.deny_command('app.erasure_ledger', 'DELETE');
GRANT SELECT ON app.erasure_ledger TO app_worker;

-- It runs as the erasure function's owner, under the table's tenant policy.
CREATE FUNCTION app.record_erasure_in_ledger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erased CONSTANT boolean := NEW.action = 'party.party.erased';
BEGIN
  INSERT INTO app.erasure_ledger (tenant_id, subject_party_id, kind, subject_key_id, audit_event_id)
  VALUES (NEW.tenant_id, NEW.subject_party_id,
          CASE WHEN erased THEN 'party_erased' ELSE 'subject_key_destroyed' END,
          CASE WHEN erased THEN NULL ELSE NEW.entity_id END,
          NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$function$;

CREATE TRIGGER record_erasure_in_ledger AFTER INSERT ON app.audit_event
  FOR EACH ROW
  WHEN ((NEW.action = 'party.party.erased' AND current_user = 'owner_party_erase_party')
     OR (NEW.action = 'platform.subject_key.destroyed'
         AND current_user = 'owner_app_destroy_subject_key'))
  EXECUTE FUNCTION app.record_erasure_in_ledger();

GRANT INSERT (tenant_id, subject_party_id, kind, subject_key_id, audit_event_id)
   ON app.erasure_ledger TO owner_party_erase_party, owner_app_destroy_subject_key;
