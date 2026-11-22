// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stand-ins for what the platform passes to crm's import and timeline code,
// for crm's integration tests alone: the file service's clean-only read,
// party's duplicate lookup and create, and grants' reads. Each reads or
// writes the other modules' tables directly, which crm's own code never does
// (ADR 0016); they are the reference for what those modules have to export,
// and are never imported by code that ships.

import type { ImportDependencies } from '../import/context.ts';
import type { Tx } from '../context.ts';
import type { GrantsReads } from '../timeline/events.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type Tables = {
  'app.file': { id: string; scan_state: string };
  'party.party': {
    id: Generated<string>;
    tenant_id: string;
    kind: 'organisation' | 'person';
    status: Generated<string>;
    merged_into: Generated<string | null>;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.organisation': {
    id: string;
    tenant_id: string;
    name: string;
    legal_form: string;
    address_line1: string;
    address_line2: string | null;
    address_town: string;
    address_postcode: string;
    address_country_code: string;
    website: string | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.organisation_identifier': {
    tenant_id: string;
    organisation_id: string;
    scheme: string;
    identifier: string;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.person': {
    id: string;
    tenant_id: string;
    given_name: string | null;
    family_name: string | null;
    email: string;
    phone: string | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'grants.application': {
    id: string;
    organisation_id: string;
    applicant_person_id: string;
    submitted_at: Date | null;
  };
  'grants.decision': { id: string; application_id: string; released_at: Date | null };
};

const db = (tx: Tx) => tx.$extendTables<Tables>();

const blank = (value: string | undefined) => (value === undefined || value === '' ? null : value);

/** The file service's read: bytes of a clean file the transaction's tenant can see, else null. */
export function testImportFiles(
  contents: ReadonlyMap<string, Uint8Array>,
): ImportDependencies['files'] {
  return {
    async open(tx, fileId) {
      const file = await db(tx)
        .selectFrom('app.file')
        .select('scan_state')
        .where('id', '=', fileId)
        .executeTakeFirst();
      const bytes = contents.get(fileId);
      if (file?.scan_state !== 'clean' || bytes === undefined) return null;
      const middle = Math.floor(bytes.length / 2);
      return (async function* () {
        await Promise.resolve();
        yield bytes.slice(0, middle);
        yield bytes.slice(middle);
      })();
    },
  };
}

/**
 * Party's duplicate lookup and staff create. The lookup reads as the migrator through `lookup`
 * (ids for a statement in a tenant), since the worker's grants on party tables are narrower than
 * the lookup needs; the create runs in the request.
 */
export function testImportParties(
  lookup: (tenant: string, sql: string, values: unknown[]) => Promise<string[]>,
): ImportDependencies['parties'] {
  return {
    async duplicates(tx, party) {
      const { tenant } = await tx
        .selectNoFrom((eb) => eb.fn<string>('app.current_tenant_id', []).as('tenant'))
        .executeTakeFirstOrThrow();
      if (party.kind === 'person') {
        const ids = await lookup(
          tenant,
          `SELECT p.id FROM party.person n JOIN party.party p ON p.id = n.id
            WHERE n.email = $1 AND p.status NOT IN ('merged', 'erased') ORDER BY p.id`,
          [party.input.email],
        );
        return ids.map((partyId) => ({ partyId, signals: ['email' as const] }));
      }
      const ids = await lookup(
        tenant,
        `SELECT o.id FROM party.organisation o JOIN party.party p ON p.id = o.id
          WHERE lower(o.name) = lower($1) AND o.address_postcode = $2
            AND p.status NOT IN ('merged', 'erased') ORDER BY o.id`,
        [party.input.name, party.input.registeredAddress.postcode],
      );
      return ids.map((partyId) => ({ partyId, signals: ['name_and_postcode' as const] }));
    },

    async create(tx, party, { membershipId }) {
      const by = { created_by: membershipId, updated_by: membershipId };
      const { id } = await db(tx)
        .insertInto('party.party')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          kind: party.kind,
          ...by,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      if (party.kind === 'person') {
        const { givenName, familyName, email, phone } = party.input;
        await db(tx)
          .insertInto('party.person')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            id,
            given_name: givenName,
            family_name: familyName,
            email,
            phone: blank(phone),
            ...by,
          }))
          .execute();
        return id;
      }
      const { name, legalForm, registeredAddress: address, website, identifiers } = party.input;
      await db(tx)
        .insertInto('party.organisation')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          id,
          name,
          legal_form: legalForm,
          address_line1: address.line1,
          address_line2: blank(address.line2),
          address_town: address.town,
          address_postcode: address.postcode,
          address_country_code: address.countryCode,
          website: blank(website),
          ...by,
        }))
        .execute();
      for (const { scheme, identifier } of identifiers) {
        await db(tx)
          .insertInto('party.organisation_identifier')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            organisation_id: id,
            scheme,
            identifier,
            ...by,
          }))
          .execute();
      }
      return id;
    },
  };
}

/** Grants' reads, as its server contract is to answer them. */
export const testGrantsReads: GrantsReads = {
  async application(tx, applicationId) {
    const row = await db(tx)
      .selectFrom('grants.application')
      .select(['organisation_id', 'applicant_person_id', 'submitted_at'])
      .where('id', '=', applicationId)
      .executeTakeFirst();
    return row === undefined || row.submitted_at === null
      ? null
      : {
          organisationId: row.organisation_id,
          applicantPersonId: row.applicant_person_id,
          submittedAt: row.submitted_at,
        };
  },

  async releasedDecision(tx, decisionId) {
    const row = await db(tx)
      .selectFrom('grants.decision as d')
      .innerJoin('grants.application as a', 'a.id', 'd.application_id')
      .select(['a.organisation_id', 'a.applicant_person_id', 'd.released_at'])
      .where('d.id', '=', decisionId)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          organisationId: row.organisation_id,
          recipientPersonId: row.applicant_person_id,
          releasedAt: row.released_at,
        };
  },
};

/** Party's resolve: the record an id reaches through a merge; null if not in this tenant. */
export async function testResolveParty(tx: Tx, partyId: string): Promise<string | null> {
  const row = await db(tx)
    .selectFrom('party.party')
    .select(['id', 'merged_into'])
    .where('id', '=', partyId)
    .executeTakeFirst();
  return row === undefined ? null : (row.merged_into ?? row.id);
}
