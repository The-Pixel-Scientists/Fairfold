-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0062, down: remove grants.erase_reminders and every right its
-- owner was given. The owner role stays: the roles script, not a migration,
-- creates and removes roles.

DROP FUNCTION grants.erase_reminders(uuid);
REVOKE SELECT (tenant_id, recipient_person_id), UPDATE (recipient_person_id)
    ON grants.reminder_email FROM owner_grants_erase_reminders;
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_grants_erase_reminders;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_grants_erase_reminders;
REVOKE USAGE ON SCHEMA app, grants, party FROM owner_grants_erase_reminders;
