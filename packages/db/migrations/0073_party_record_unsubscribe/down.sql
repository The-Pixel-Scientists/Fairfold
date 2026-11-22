-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0073, down: drop party.record_unsubscribe() and its owner's
-- rights and policies. Rows it recorded stay. migrator owns the schema, so
-- it may drop the function (ADR 0023). The owner role stays: the roles
-- script, not a migration, creates and removes roles.

DROP FUNCTION party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid);

DROP POLICY record_unsubscribe_insert ON app.audit_event;
DROP POLICY record_unsubscribe_select ON app.retention_policy;
DROP POLICY record_unsubscribe_insert ON party.suppression;
DROP POLICY record_unsubscribe_select ON party.suppression;
DROP POLICY record_unsubscribe_insert ON party.consent;
DROP POLICY record_unsubscribe_select ON party.consent;
DROP POLICY record_unsubscribe_lock ON party.party;
DROP POLICY record_unsubscribe_select ON party.party;
DROP POLICY record_unsubscribe_select ON party.person;
DROP POLICY record_unsubscribe_select ON app.tenant;

REVOKE INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
               subject_party_id, changes)
    ON app.audit_event FROM owner_party_record_unsubscribe;
REVOKE SELECT (tenant_id, policy, days) ON app.retention_policy FROM owner_party_record_unsubscribe;
REVOKE SELECT (tenant_id, person_id, channel, purpose, reason, address_hash),
       INSERT (tenant_id, id, person_id, channel, purpose, reason, source, address_hash,
               hash_key_version)
    ON party.suppression FROM owner_party_record_unsubscribe;
REVOKE SELECT (tenant_id, person_id, purpose, channel, state, privacy_notice_version, recorded_at),
       INSERT (tenant_id, id, person_id, purpose, channel, state, privacy_notice_version, source)
    ON party.consent FROM owner_party_record_unsubscribe;
REVOKE SELECT (tenant_id, id, kind, status), UPDATE (updated_at)
    ON party.party FROM owner_party_record_unsubscribe;
REVOKE SELECT (tenant_id, id) ON party.person FROM owner_party_record_unsubscribe;
REVOKE SELECT (id, status) ON app.tenant FROM owner_party_record_unsubscribe;
SET LOCAL ROLE owner_party_is_erased;
REVOKE EXECUTE ON FUNCTION party.is_erased(uuid, uuid) FROM owner_party_record_unsubscribe;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_party_record_unsubscribe;
REVOKE USAGE ON SCHEMA app, party FROM owner_party_record_unsubscribe;
