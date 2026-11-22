-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0079, down: remove the forms schema, in reverse order. Dropping
-- it would lose every form and response (switching forms off, by contrast,
-- keeps them), so this refuses, before it changes anything, while any forms
-- table holds a row. Row-level security hides every tenant's rows from
-- migrator, but validating a check reads every row whatever the policies.
-- Outside development the rollback for this migration is a restore from
-- backup (ADR 0003). The audit events anonymous submissions wrote stay, as
-- the audit log is append-only. Nothing cascades: while a later migration's
-- objects still refer to these tables, this fails and changes nothing. The
-- owner roles stay: the roles script, not a migration, creates and removes
-- roles.

DO $refuse$
DECLARE
  forms_table regclass;
BEGIN
  FOR forms_table IN SELECT c.oid FROM pg_catalog.pg_class c
                      WHERE c.relnamespace = 'forms'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT rollback_empty CHECK (false)',
                              forms_table);
  END LOOP;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0079 cannot be rolled back while forms holds rows: they would be lost with the schema.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP FUNCTION forms.erase_subject(uuid);
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_forms_erase_subject;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_forms_erase_subject;
REVOKE USAGE ON SCHEMA app, party FROM owner_forms_erase_subject;

DROP FUNCTION
  forms.submit_public_response(text, uuid, uuid, jsonb, bytea, bytea, bytea, bytea, uuid);
DROP POLICY submit_public_response_insert ON app.audit_event;
DROP POLICY submit_public_response_select ON app.retention_policy;
DROP POLICY submit_public_response_select ON app.tenant_module;
DROP POLICY submit_public_response_select ON app.tenant;
REVOKE INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
    ON app.audit_event FROM owner_forms_submit_public_response;
REVOKE SELECT (tenant_id, policy, days) ON app.retention_policy
  FROM owner_forms_submit_public_response;
REVOKE SELECT (tenant_id, module, enabled) ON app.tenant_module
  FROM owner_forms_submit_public_response;
REVOKE SELECT (id, slug, status) ON app.tenant FROM owner_forms_submit_public_response;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_forms_submit_public_response;
REVOKE USAGE ON SCHEMA app FROM owner_forms_submit_public_response;

DROP TABLE forms.respondent_token;
DROP FUNCTION forms.prepare_token();
DROP TABLE forms.response;
DROP FUNCTION forms.check_response_version();
DROP FUNCTION forms.keep_response();
DROP FUNCTION forms.answers_are_clean(jsonb);
DROP TABLE forms.form_version;
DROP FUNCTION forms.prepare_version();
DROP TABLE forms.form;
DROP FUNCTION forms.set_archived_at();
DROP SCHEMA forms;
