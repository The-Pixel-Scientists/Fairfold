-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0062, up: grants.erase_reminders, the approved erasure of a
-- reminder's recipient (S12-21, ADR 0027), owned by its own owner role
-- (ADR 0023) and callable by app_worker alone.

-- The approved erasure of a reminder's recipient (ADR 0027), run by the
-- erasure job after party.erase_party, in the tenant set in the transaction.
-- It refuses unless the party is already erased there, clears the party as
-- recipient, and keeps ids, status and times; a pending reminder with no
-- recipient is skipped when it falls due. A repeat call changes nothing
-- further. It writes no audit event: the erasure's own event covers it.
CREATE FUNCTION grants.erase_reminders(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  reminders integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_reminders.party_id AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s reminders are erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE grants.reminder_email r SET recipient_person_id = NULL
   WHERE r.tenant_id = erase_tenant AND r.recipient_person_id = erase_reminders.party_id;
  GET DIAGNOSTICS reminders = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('grants.reminder_email', reminders);
END
$function$;

GRANT USAGE ON SCHEMA app, grants, party TO owner_grants_erase_reminders;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_grants_erase_reminders;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_grants_erase_reminders;
GRANT SELECT (tenant_id, recipient_person_id), UPDATE (recipient_person_id)
   ON grants.reminder_email TO owner_grants_erase_reminders;

REVOKE ALL ON FUNCTION grants.erase_reminders(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grants.erase_reminders(uuid) TO app_worker;
GRANT CREATE ON SCHEMA grants TO owner_grants_erase_reminders;
ALTER FUNCTION grants.erase_reminders(uuid) OWNER TO owner_grants_erase_reminders;
REVOKE CREATE ON SCHEMA grants FROM owner_grants_erase_reminders;
