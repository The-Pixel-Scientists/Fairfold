-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0031, up: app.purge_expired_audit(), the one approved deletion
-- from the audit tables (ADR 0003, "Audit retention: the exception to rule
-- 4"; S11-97).
--
-- With a tenant set, it deletes that tenant's expired app.audit_event rows;
-- with none set, expired auth.audit_event rows. Either way it then records
-- the count in the table it purged, in the same transaction. Its owner's
-- DELETE policies, the only permissive ones on either table, match only
-- rows past the retain_until that the insert triggers set, so even the
-- purge cannot remove an event inside its retention period. An expired auth
-- event still waiting for its tenant copy keeps its auth.audit_copy_pending
-- row's ON DELETE RESTRICT key: the call fails and deletes nothing.
--
-- The owner gets only the columns the function and the retention trigger
-- use, never occurred_at, retain_until or actor_member_kind, which the
-- database sets. Every right and policy here is listed in
-- test/catalogue/app.ts.

-- The purge event in auth.audit_event, with its count.
ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
  'passkey_removed', 'audit_purged'));
ALTER TABLE auth.audit_event ADD COLUMN purged_count integer CHECK (purged_count >= 0);
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_purged_count_code
  CHECK ((code = 'audit_purged') = (purged_count IS NOT NULL));

-- Each batch finds the oldest expired rows without reading the whole table.
CREATE INDEX audit_event_retain_until ON app.audit_event (tenant_id, retain_until);
CREATE INDEX audit_event_retain_until ON auth.audit_event (retain_until);

CREATE FUNCTION app.purge_expired_audit()
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  batch_size CONSTANT integer := 1000;
  -- A multiple of batch_size. The caller calls again while a call returns it.
  max_rows CONSTANT integer := 10000;
  purge_tenant CONSTANT uuid := app.current_tenant_id();
  deleted integer;
  total integer := 0;
BEGIN
  -- Each batch takes its ids first, so the delete finds them by primary key.
  LOOP
    IF purge_tenant IS NULL THEN
      DELETE FROM auth.audit_event
       WHERE id = ANY (ARRAY(SELECT e.id FROM auth.audit_event AS e
                              WHERE e.retain_until < pg_catalog.now()
                              ORDER BY e.retain_until LIMIT batch_size));
    ELSE
      DELETE FROM app.audit_event
       WHERE id = ANY (ARRAY(SELECT e.id FROM app.audit_event AS e
                              WHERE e.tenant_id = purge_tenant
                                AND e.retain_until < pg_catalog.now()
                              ORDER BY e.retain_until LIMIT batch_size));
    END IF;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    total := total + deleted;
    EXIT WHEN deleted < batch_size OR total >= max_rows;
  END LOOP;

  IF purge_tenant IS NULL THEN
    INSERT INTO auth.audit_event (request_id, code, purged_count)
    VALUES (pg_catalog.gen_random_uuid(), 'audit_purged', total);
  ELSE
    INSERT INTO app.audit_event
      (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
    VALUES (purge_tenant, pg_catalog.gen_random_uuid(), 'system', 'platform.audit_event.purged',
            'platform.audit_event', purge_tenant, pg_catalog.jsonb_build_object('count', total));
  END IF;
  RETURN total;
END
$function$;

-- The owner's rights. app.retention_policy is read by the BEFORE INSERT
-- trigger on app.audit_event, which runs with the owner's rights, through
-- that table's tenant_select policy.
GRANT USAGE ON SCHEMA app, auth TO owner_app_purge_expired_audit;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_purge_expired_audit;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy TO owner_app_purge_expired_audit;
GRANT SELECT (id, tenant_id, retain_until), DELETE,
      INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
   ON app.audit_event TO owner_app_purge_expired_audit;
GRANT SELECT (id, retain_until), DELETE, INSERT (request_id, code, purged_count)
   ON auth.audit_event TO owner_app_purge_expired_audit;

-- The owner's policies. app.audit_event's tenant_select and tenant_insert
-- are TO PUBLIC, so they apply to the owner too, still within the tenant.
CREATE POLICY purge_expired_audit_select ON app.audit_event
  FOR SELECT TO owner_app_purge_expired_audit
  USING (retain_until < now() AND tenant_id = app.current_tenant_id());
CREATE POLICY purge_expired_audit_delete ON app.audit_event
  FOR DELETE TO owner_app_purge_expired_audit
  USING (retain_until < now() AND tenant_id = app.current_tenant_id());
CREATE POLICY purge_expired_audit_insert ON app.audit_event
  FOR INSERT TO owner_app_purge_expired_audit
  WITH CHECK (action = 'platform.audit_event.purged' AND tenant_id = app.current_tenant_id());
CREATE POLICY purge_expired_audit_select ON auth.audit_event
  FOR SELECT TO owner_app_purge_expired_audit
  USING (retain_until < now());
CREATE POLICY purge_expired_audit_delete ON auth.audit_event
  FOR DELETE TO owner_app_purge_expired_audit
  USING (retain_until < now());
CREATE POLICY purge_expired_audit_insert ON auth.audit_event
  FOR INSERT TO owner_app_purge_expired_audit
  WITH CHECK (code = 'audit_purged');

-- Hand the function to its owner (ADR 0023), with app_worker alone able
-- to call it.
REVOKE ALL ON FUNCTION app.purge_expired_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_expired_audit() TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_purge_expired_audit;
ALTER FUNCTION app.purge_expired_audit() OWNER TO owner_app_purge_expired_audit;
REVOKE CREATE ON SCHEMA app FROM owner_app_purge_expired_audit;
