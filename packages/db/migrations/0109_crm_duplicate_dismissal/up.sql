-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0109, up: crm duplicate dismissals (B15-03, ADR 0025), so
-- dismissDuplicate in modules/crm/src/contracts/duplicates.ts can hide a
-- pair from both duplicate lists. A dismissal holds the pair, lower party id
-- first so a pair has one form, both of one kind, the reason from the
-- contract's list, and who dismissed it and when (created_by, created_at).
-- Party ids and a code only: no name, signal or matched value, so crm's
-- erasure has nothing to clear here. A dismissal is append-only for every
-- app role and is not re-pointed by a merge: it stays the record of what
-- staff said about that pair. The server writes the audit event with the
-- actor from the session (rules 4 and 6).

CREATE TABLE crm.duplicate_dismissal (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('organisation', 'person')),
  party_id uuid NOT NULL,
  other_party_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'different_organisation', 'different_person', 'related_but_separate', 'duplicate_allowed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT duplicate_dismissal_pair UNIQUE (tenant_id, party_id, other_party_id),
  CONSTRAINT duplicate_dismissal_order CHECK (party_id < other_party_id),
  CONSTRAINT duplicate_dismissal_author CHECK (updated_by = created_by),
  FOREIGN KEY (tenant_id, party_id, kind)
    REFERENCES party.party (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, other_party_id, kind)
    REFERENCES party.party (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX duplicate_dismissal_other ON crm.duplicate_dismissal (tenant_id, other_party_id);
SELECT app.enable_tenant_rls('crm.duplicate_dismissal');
SELECT app.deny_command('crm.duplicate_dismissal', 'UPDATE');
SELECT app.deny_command('crm.duplicate_dismissal', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.duplicate_dismissal
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.duplicate_dismissal
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT ON crm.duplicate_dismissal
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id', 'other_party_id');
GRANT SELECT, INSERT (tenant_id, kind, party_id, other_party_id, reason, created_by, updated_by)
   ON crm.duplicate_dismissal TO app_api;
