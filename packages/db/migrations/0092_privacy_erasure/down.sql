-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0092, down: remove privacy.erase_subject and every right its
-- owner was given. The owner role stays: the roles script, not a
-- migration, creates and removes roles.

DROP FUNCTION privacy.erase_subject(uuid);
REVOKE SELECT (tenant_id, request_id, title), UPDATE (title) ON privacy.request_task
  FROM owner_privacy_erase_subject;
REVOKE SELECT (tenant_id, id, subject_person_id, summary), UPDATE (summary)
    ON privacy.rights_request FROM owner_privacy_erase_subject;
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_privacy_erase_subject;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_privacy_erase_subject;
REVOKE USAGE ON SCHEMA app, party, privacy FROM owner_privacy_erase_subject;
