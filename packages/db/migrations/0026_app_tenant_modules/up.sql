-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0026, up: no tool is on by default, and a module switch or a
-- configuration version may have the operator as its author (ADR 0024).
--
-- Tenant creation and the operator's backfill have no membership to name,
-- so both tables take app.audit_event's actor shape: a kind, user or
-- operator, with the membership set exactly when the kind is user. The
-- composite foreign keys stay, so a user author is always a membership of
-- the row's tenant. Each kind defaults to user, so every existing row
-- already passes and none is rewritten; adding a check reads each row
-- without changing it. app_api gets no grant on either kind, so every row
-- it writes is a user row that names its membership.
--
-- Nothing here reads or writes a tenant's rows, and no role gains BYPASSRLS
-- or any other grant: existing tenants keep grants through the operator
-- backfill (S11-69), which runs at deploy before the policy that treats a
-- missing row as off.

COMMENT ON TABLE app.tenant_module IS
  'Which switchable modules a tenant uses (ADR 0024). A module is on only where its row has enabled true; no row, or enabled false, means off.';

ALTER TABLE app.tenant_module
  ALTER COLUMN updated_by DROP NOT NULL,
  ADD COLUMN updated_by_kind text NOT NULL DEFAULT 'user'
    CONSTRAINT tenant_module_updated_by_kind_check CHECK (updated_by_kind IN ('user', 'operator')),
  ADD CONSTRAINT tenant_module_author CHECK ((updated_by_kind = 'user') = (updated_by IS NOT NULL));

-- Only app_api updates a switch, and always for a member, so an update makes
-- the row a user row again and the check then needs the membership.
CREATE FUNCTION app.set_user_author()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.updated_by_kind := 'user';
  RETURN NEW;
END
$function$;

CREATE TRIGGER set_user_author BEFORE UPDATE ON app.tenant_module
  FOR EACH ROW EXECUTE FUNCTION app.set_user_author();

ALTER TABLE app.config_version
  ALTER COLUMN author_id DROP NOT NULL,
  ADD COLUMN author_kind text NOT NULL DEFAULT 'user'
    CONSTRAINT config_version_author_kind_check CHECK (author_kind IN ('user', 'operator')),
  ADD CONSTRAINT config_version_author CHECK ((author_kind = 'user') = (author_id IS NOT NULL));
