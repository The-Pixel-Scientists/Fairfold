-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0073, up: party.record_unsubscribe(), the approved definer
-- function behind the public one-click unsubscribe (ADR 0033; S12-53).
--
-- The API verifies the token, which the database never sees, and passes its
-- ids. The function writes into the tenant its argument names, so it runs
-- only with no tenant set, never in a signed-in or job transaction, and
-- sets none. It records one withdrawal for one person, purpose and channel,
-- returns only a fixed code, and reads or returns no personal value. Its
-- owner (roles script, version 5) holds only the columns it reads and
-- writes, and its policies admit only the rows it writes. Every right and
-- policy here is listed in test/catalogue/party.ts.

-- 'refused' writes nothing: a tenant is set, an argument is missing or
-- outside its list, the tenant is unknown or not active, or the person is
-- not in it or is erased. Locking the person's party waits for an erasure
-- in progress, and for another unsubscribe of the same person, so a repeat
-- sees the first and answers 'already_unsubscribed'. With no earlier
-- consent there is none to withdraw, so only the suppression is recorded;
-- otherwise the withdrawal keeps the notice version of the consent it ends.
CREATE FUNCTION party.record_unsubscribe(
  tenant_id uuid, person_id uuid, purpose text, channel text, address_hash bytea,
  hash_key_version integer, request_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  latest_state text;
  notice text;
  consent_id uuid;
  suppression_id uuid;
BEGIN
  IF app.current_tenant_id() IS NOT NULL
     OR record_unsubscribe.tenant_id IS NULL OR record_unsubscribe.person_id IS NULL
     OR record_unsubscribe.request_id IS NULL
     OR record_unsubscribe.purpose IS NULL
     OR record_unsubscribe.purpose NOT IN ('future_funding')
     OR record_unsubscribe.channel IS NULL
     OR record_unsubscribe.channel NOT IN ('email', 'sms', 'phone', 'post')
     OR (record_unsubscribe.address_hash IS NULL) <> (record_unsubscribe.channel = 'post')
     OR (record_unsubscribe.hash_key_version IS NULL)
        <> (record_unsubscribe.address_hash IS NULL)
     OR pg_catalog.octet_length(record_unsubscribe.address_hash) <> 32
     OR record_unsubscribe.hash_key_version < 1 THEN
    RETURN 'refused';
  END IF;
  PERFORM FROM app.tenant t
   WHERE t.id = record_unsubscribe.tenant_id AND t.status = 'active';
  IF NOT FOUND THEN
    RETURN 'refused';
  END IF;
  PERFORM FROM party.person pe
    JOIN party.party pa ON pa.tenant_id = pe.tenant_id AND pa.id = pe.id
   WHERE pe.tenant_id = record_unsubscribe.tenant_id AND pe.id = record_unsubscribe.person_id
     AND pa.status <> 'erased'
     FOR NO KEY UPDATE OF pa;
  IF NOT FOUND THEN
    RETURN 'refused';
  END IF;

  SELECT c.state, c.privacy_notice_version INTO latest_state, notice
    FROM party.consent c
   WHERE c.tenant_id = record_unsubscribe.tenant_id AND c.person_id = record_unsubscribe.person_id
     AND c.purpose = record_unsubscribe.purpose AND c.channel = record_unsubscribe.channel
   ORDER BY c.recorded_at DESC
   LIMIT 1;
  IF latest_state = 'given' THEN
    consent_id := pg_catalog.gen_random_uuid();
    INSERT INTO party.consent (tenant_id, id, person_id, purpose, channel, state,
                               privacy_notice_version, source)
    VALUES (record_unsubscribe.tenant_id, consent_id, record_unsubscribe.person_id,
            record_unsubscribe.purpose, record_unsubscribe.channel, 'withdrawn', notice,
            'unsubscribe');
    INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                 entity_id, subject_party_id, changes)
    VALUES (record_unsubscribe.tenant_id, record_unsubscribe.request_id, 'system',
            'party.consent.recorded', 'party.consent', consent_id, record_unsubscribe.person_id,
            '{"party.consent.purpose": {}, "party.consent.channel": {}, "party.consent.state": {}, "party.consent.source": {}}');
  END IF;

  IF consent_id IS NOT NULL OR NOT EXISTS (
       SELECT FROM party.suppression s
        WHERE s.tenant_id = record_unsubscribe.tenant_id
          AND s.person_id = record_unsubscribe.person_id
          AND s.channel = record_unsubscribe.channel AND s.purpose = record_unsubscribe.purpose
          AND s.reason = 'unsubscribed'
          AND s.address_hash IS NOT DISTINCT FROM record_unsubscribe.address_hash) THEN
    suppression_id := pg_catalog.gen_random_uuid();
    INSERT INTO party.suppression (tenant_id, id, person_id, channel, purpose, reason, source,
                                   address_hash, hash_key_version)
    VALUES (record_unsubscribe.tenant_id, suppression_id, record_unsubscribe.person_id,
            record_unsubscribe.channel, record_unsubscribe.purpose, 'unsubscribed', 'unsubscribe',
            record_unsubscribe.address_hash, record_unsubscribe.hash_key_version);
    INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                 entity_id, subject_party_id, changes)
    VALUES (record_unsubscribe.tenant_id, record_unsubscribe.request_id, 'system',
            'party.suppression.added', 'party.suppression', suppression_id,
            record_unsubscribe.person_id,
            '{"party.suppression.channel": {}, "party.suppression.purpose": {}, "party.suppression.reason": {}, "party.suppression.source": {}, "party.suppression.address_hash": {}}');
    RETURN 'unsubscribed';
  END IF;
  RETURN 'already_unsubscribed';
END
$function$;

-- The owner's rights. The erased-party guards on consent and suppressions,
-- and the audit retention trigger, run with them. The lock clause needs an
-- UPDATE right; the owner's is on updated_at, and its UPDATE policy admits
-- no new row, so it updates nothing.
GRANT USAGE ON SCHEMA app, party TO owner_party_record_unsubscribe;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_party_record_unsubscribe;
-- party.is_erased()'s owner grants its right (ADR 0023).
SET LOCAL ROLE owner_party_is_erased;
GRANT EXECUTE ON FUNCTION party.is_erased(uuid, uuid) TO owner_party_record_unsubscribe;
RESET ROLE;
GRANT SELECT (id, status) ON app.tenant TO owner_party_record_unsubscribe;
GRANT SELECT (tenant_id, id) ON party.person TO owner_party_record_unsubscribe;
GRANT SELECT (tenant_id, id, kind, status), UPDATE (updated_at)
   ON party.party TO owner_party_record_unsubscribe;
GRANT SELECT (tenant_id, person_id, purpose, channel, state, privacy_notice_version, recorded_at),
      INSERT (tenant_id, id, person_id, purpose, channel, state, privacy_notice_version, source)
   ON party.consent TO owner_party_record_unsubscribe;
GRANT SELECT (tenant_id, person_id, channel, purpose, reason, address_hash),
      INSERT (tenant_id, id, person_id, channel, purpose, reason, source, address_hash,
              hash_key_version)
   ON party.suppression TO owner_party_record_unsubscribe;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy TO owner_party_record_unsubscribe;
GRANT INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
              subject_party_id, changes)
   ON app.audit_event TO owner_party_record_unsubscribe;

-- The owner's policies. No tenant is set, so the tenant policies, TO PUBLIC,
-- admit nothing, and these admit only what the function reads and writes.
CREATE POLICY record_unsubscribe_select ON app.tenant FOR SELECT
  TO owner_party_record_unsubscribe USING (status = 'active');
CREATE POLICY record_unsubscribe_select ON party.person FOR SELECT
  TO owner_party_record_unsubscribe USING (true);
CREATE POLICY record_unsubscribe_select ON party.party FOR SELECT
  TO owner_party_record_unsubscribe USING (kind = 'person');
CREATE POLICY record_unsubscribe_lock ON party.party FOR UPDATE
  TO owner_party_record_unsubscribe USING (kind = 'person') WITH CHECK (false);
CREATE POLICY record_unsubscribe_select ON party.consent FOR SELECT
  TO owner_party_record_unsubscribe USING (true);
CREATE POLICY record_unsubscribe_insert ON party.consent FOR INSERT
  TO owner_party_record_unsubscribe
  WITH CHECK (state = 'withdrawn' AND source = 'unsubscribe');
CREATE POLICY record_unsubscribe_select ON party.suppression FOR SELECT
  TO owner_party_record_unsubscribe USING (reason = 'unsubscribed');
CREATE POLICY record_unsubscribe_insert ON party.suppression FOR INSERT
  TO owner_party_record_unsubscribe
  WITH CHECK (reason = 'unsubscribed' AND source = 'unsubscribe');
CREATE POLICY record_unsubscribe_select ON app.retention_policy FOR SELECT
  TO owner_party_record_unsubscribe USING (policy = 'audit');
CREATE POLICY record_unsubscribe_insert ON app.audit_event FOR INSERT
  TO owner_party_record_unsubscribe
  WITH CHECK (actor_kind = 'system' AND subject_party_id IS NOT NULL
              AND action IN ('party.consent.recorded', 'party.suppression.added'));

REVOKE ALL ON FUNCTION party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid)
   TO app_api;
GRANT CREATE ON SCHEMA party TO owner_party_record_unsubscribe;
ALTER FUNCTION party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid)
  OWNER TO owner_party_record_unsubscribe;
REVOKE CREATE ON SCHEMA party FROM owner_party_record_unsubscribe;
