-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0015, up: app.invitation, an invitation to join a tenant's team
-- with chosen console roles (ADR 0010, "Accounts, memberships and
-- invitations"), including the operator's first invitation in a new tenant
-- (ADR 0019).
--
-- The token is kept only as its SHA-256 hash. The database sets the expiry,
-- 7 days (168 hours, whatever the session's time zone) after creation, so
-- no app role chooses it. A row starts pending and moves once, to accepted,
-- with the membership it made, or to revoked; a final row never changes.
-- At most one invitation per address is pending in a tenant. app_api reads,
-- adds and settles invitations, always naming the member who acted.
-- app_worker, as the operator, only adds one, with no inviter. Nothing
-- deletes an invitation, which is the retention sweep's job. The roles in
-- the check copy the console roles in packages/domain/src/platform, and a
-- test keeps the two in step.

CREATE TABLE app.invitation (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (
    email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  roles text[] NOT NULL CHECK (
    array_ndims(roles) = 1 AND cardinality(roles) > 0
    AND roles <@ ARRAY['tenant_admin', 'programme_manager', 'reviewer']),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '168 hours',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  accepted_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT invitation_lasts_7_days CHECK (expires_at = created_at + interval '168 hours'),
  CONSTRAINT invitation_accepted_membership
    CHECK ((status = 'accepted') = (accepted_membership_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, accepted_membership_id)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX invitation_one_pending ON app.invitation (tenant_id, email)
  WHERE status = 'pending';

SELECT app.enable_tenant_rls('app.invitation');
SELECT app.deny_command('app.invitation', 'DELETE');
-- Only the operator, as app_worker, invites with no inviter; app_api always
-- names the member who invited or changed an invitation.
CREATE POLICY invitation_insert_by_member ON app.invitation AS RESTRICTIVE FOR INSERT
  TO app_api WITH CHECK (created_by IS NOT NULL AND updated_by IS NOT NULL);
CREATE POLICY invitation_update_by_member ON app.invitation AS RESTRICTIVE FOR UPDATE
  TO app_api USING (true) WITH CHECK (updated_by IS NOT NULL);

-- Only a pending invitation changes; an accepted or revoked one is final.
CREATE FUNCTION app.keep_final_invitation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation % is final.', OLD.id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_final_invitation BEFORE UPDATE ON app.invitation
  FOR EACH ROW EXECUTE FUNCTION app.keep_final_invitation();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.invitation
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

GRANT SELECT,
      INSERT (tenant_id, id, email, roles, token_hash, created_by, updated_by),
      UPDATE (status, accepted_membership_id, updated_by)
   ON app.invitation TO app_api;
GRANT INSERT (tenant_id, id, email, roles, token_hash) ON app.invitation TO app_worker;
