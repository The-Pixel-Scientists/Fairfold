-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0072, up: suppressions, the unsubscribe consent source and the
-- current-consent view (ADR 0033; S12-53).
--
-- No row is rewritten or updated. The checked lists copy S11-44's
-- contracts in modules/party/src/contracts/lists.ts, which
-- test/party/suppression.test.ts reads back.

-- An unsubscribe is recorded by party.record_unsubscribe() (migration 0073)
-- with no member, so recorded_by is null exactly for that source. Every
-- existing row is portal or staff with a member, so both checks hold.
ALTER TABLE party.consent
  ALTER COLUMN recorded_by DROP NOT NULL,
  DROP CONSTRAINT consent_source_check,
  ADD CONSTRAINT consent_source_check CHECK (source IN ('portal', 'staff', 'unsubscribe')),
  ADD CONSTRAINT consent_recorded_by CHECK ((recorded_by IS NULL) = (source = 'unsubscribe'));

-- Only the function records an unsubscribe.
CREATE POLICY app_source ON party.consent AS RESTRICTIVE FOR INSERT TO app_api
  WITH CHECK (source <> 'unsubscribe');

-- That a person must not be contacted on a channel, for one purpose or,
-- with no purpose, for all marketing. Append-only: a suppression stops
-- applying only when the person gives consent again themselves, or, for a
-- bounce, when the address changes. address_hash is the HMAC-SHA-256 of the
-- address under the tenant's key of hash_key_version, computed outside the
-- database, and is all that is kept of the address. A bounce matches by
-- address alone, so it needs one. The source fixes the reasons it may
-- record, and a member records exactly the staff ones.
CREATE TABLE party.suppression (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'phone', 'post')),
  purpose text CHECK (purpose IN ('future_funding')),
  reason text NOT NULL
    CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'fps_request', 'staff_entry')),
  source text NOT NULL CHECK (source IN ('unsubscribe', 'staff', 'system')),
  address_hash bytea CHECK (octet_length(address_hash) = 32),
  hash_key_version integer CHECK (hash_key_version >= 1),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT suppression_hash_version
    CHECK ((address_hash IS NULL) = (hash_key_version IS NULL)),
  CONSTRAINT suppression_post_unhashed CHECK (channel <> 'post' OR address_hash IS NULL),
  CONSTRAINT suppression_bounce_hashed CHECK (reason <> 'bounced' OR address_hash IS NOT NULL),
  CONSTRAINT suppression_reason_purpose CHECK (CASE reason
    WHEN 'unsubscribed' THEN purpose IS NOT NULL
    WHEN 'staff_entry' THEN true
    ELSE purpose IS NULL END),
  CONSTRAINT suppression_source_reason CHECK (CASE source
    WHEN 'unsubscribe' THEN reason = 'unsubscribed'
    WHEN 'staff' THEN reason IN ('fps_request', 'staff_entry')
    ELSE reason = 'bounced' END),
  CONSTRAINT suppression_recorded_by CHECK ((recorded_by IS NOT NULL) = (source = 'staff')),
  FOREIGN KEY (tenant_id, person_id) REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX suppression_person ON party.suppression (tenant_id, person_id, channel);
CREATE INDEX suppression_address ON party.suppression (tenant_id, channel, address_hash)
  WHERE address_hash IS NOT NULL;
SELECT app.enable_tenant_rls('party.suppression');
SELECT app.deny_command('party.suppression', 'UPDATE');
SELECT app.deny_command('party.suppression', 'DELETE');
-- No new suppression names an erased person (ADR 0027).
CREATE TRIGGER refuse_erased_party BEFORE INSERT ON party.suppression
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('person_id');

-- Staff record their entries through the API; the sender, in the worker,
-- records bounces. The worker also reads them for the consent check and
-- subject access.
GRANT SELECT,
      INSERT (tenant_id, person_id, channel, purpose, reason, source, address_hash,
              hash_key_version, recorded_by)
   ON party.suppression TO app_api, app_worker;
CREATE POLICY app_source ON party.suppression AS RESTRICTIVE FOR INSERT TO app_api
  WITH CHECK (source = 'staff');
CREATE POLICY worker_source ON party.suppression AS RESTRICTIVE FOR INSERT TO app_worker
  WITH CHECK (source = 'system');

-- The current consent for each person, purpose and channel that has any,
-- and whether a suppression matched by person applies to it: one for the
-- purpose or for all marketing, other than a bounce, recorded after the
-- person's latest consent from their own portal session. Matching by
-- address hash needs the recipient's address, so the sender adds it. Row-
-- level security applies through security_invoker.
CREATE VIEW party.current_consent WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.tenant_id, c.person_id, c.purpose, c.channel)
       c.tenant_id, c.person_id, c.purpose, c.channel, c.state, c.recorded_at,
       EXISTS (
         SELECT FROM party.suppression s
          WHERE s.tenant_id = c.tenant_id AND s.person_id = c.person_id
            AND s.channel = c.channel AND s.reason <> 'bounced'
            AND (s.purpose IS NULL OR s.purpose = c.purpose)
            AND NOT EXISTS (
              SELECT FROM party.consent g
               WHERE g.tenant_id = s.tenant_id AND g.person_id = s.person_id
                 AND g.purpose = c.purpose AND g.channel = s.channel
                 AND g.state = 'given' AND g.source = 'portal'
                 AND g.recorded_at > s.recorded_at)) AS suppressed
  FROM party.consent c
 ORDER BY c.tenant_id, c.person_id, c.purpose, c.channel, c.recorded_at DESC, c.id DESC;
GRANT SELECT ON party.current_consent TO app_api, app_worker;
