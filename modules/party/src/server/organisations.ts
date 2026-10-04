// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Organisations and the people who are their contacts. An identifier an
// applicant types is only a claim (ADR 0017): creating an organisation always
// makes a new record, and nothing here looks one up by identifier except
// staff search.

import type { Id } from '@pixel-scientists/domain';

import {
  identifierSchemeIds,
  normaliseIdentifier,
  type ConsoleOrganisation,
  type IdentifierInput,
  type OrganisationInput,
  type OrganisationPage,
  type OrganisationQuery,
  type OrganisationSummary,
  type PortalOrganisation,
} from '../contracts/index.ts';
import { partyDb, type PartyDb, type Tx } from './tables.ts';

const PAGE_SIZE = 25;

/** Who acts: a membership of this tenant. */
interface Actor {
  readonly membershipId: string;
}

const blankAsNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

function organisationColumns(input: OrganisationInput) {
  const address = input.registeredAddress;
  return {
    name: input.name,
    legal_form: input.legalForm,
    address_line1: address.line1,
    address_line2: blankAsNull(address.line2),
    address_town: address.town,
    address_postcode: address.postcode,
    address_country_code: address.countryCode,
    website: blankAsNull(input.website),
  };
}

/** Add an organisation, with its identifiers as unverified claims and the person as its contact. */
export async function createOrganisation(
  tx: Tx,
  actor: Actor,
  personId: string,
  input: OrganisationInput,
): Promise<{ readonly organisationId: Id; readonly relationshipId: Id }> {
  const db = partyDb(tx);
  const by = { created_by: actor.membershipId, updated_by: actor.membershipId };
  const party = await db
    .insertInto('party.party')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      kind: 'organisation',
      ...by,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('party.organisation')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      id: party.id,
      ...organisationColumns(input),
      ...by,
    }))
    .execute();
  for (const identifier of input.identifiers) {
    await addIdentifier(db, actor, party.id, identifier);
  }
  const link = await db
    .insertInto('party.relationship')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      type: 'contact_for',
      subject_id: personId,
      subject_kind: 'person',
      object_id: party.id,
      object_kind: 'organisation',
      ...by,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return { organisationId: party.id, relationshipId: link.id };
}

/**
 * Replace an organisation's details. An identifier of a type the organisation
 * already has is changed, which drops any verification; one of a new type is
 * added. A type left out is kept, since no app role may delete a row.
 * Returns false if the organisation does not exist.
 */
export async function updateOrganisation(
  tx: Tx,
  actor: Actor,
  organisationId: string,
  input: OrganisationInput,
): Promise<boolean> {
  const db = partyDb(tx);
  const updated = await db
    .updateTable('party.organisation')
    .set({ ...organisationColumns(input), updated_by: actor.membershipId })
    .where('id', '=', organisationId)
    .executeTakeFirst();
  if (updated.numUpdatedRows === 0n) return false;

  const held = new Map(
    (
      await db
        .selectFrom('party.organisation_identifier')
        .select(['id', 'scheme', 'identifier'])
        .where('organisation_id', '=', organisationId)
        .execute()
    ).map((row) => [row.scheme, row]),
  );
  for (const next of input.identifiers) {
    const current = held.get(next.scheme);
    if (current === undefined) {
      await addIdentifier(db, actor, organisationId, next);
    } else if (current.identifier !== next.identifier) {
      await db
        .updateTable('party.organisation_identifier')
        .set({ identifier: next.identifier, updated_by: actor.membershipId })
        .where('id', '=', current.id)
        .execute();
    }
  }
  return true;
}

async function addIdentifier(
  db: PartyDb,
  actor: Actor,
  organisationId: string,
  { scheme, identifier }: IdentifierInput,
): Promise<void> {
  await db
    .insertInto('party.organisation_identifier')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      organisation_id: organisationId,
      scheme,
      identifier,
      created_by: actor.membershipId,
      updated_by: actor.membershipId,
    }))
    .execute();
}

interface SummaryRow {
  readonly id: string;
  readonly name: string;
  readonly legal_form: OrganisationSummary['legalForm'];
}

/** Rows with their identifiers, verified or not, in the rows' order. */
async function withIdentifiers(
  db: PartyDb,
  rows: readonly SummaryRow[],
): Promise<OrganisationSummary[]> {
  if (rows.length === 0) return [];
  const identifiers = await db
    .selectFrom('party.organisation_identifier')
    .select(['organisation_id', 'scheme', 'identifier', 'verified_at'])
    .where(
      'organisation_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('scheme')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    legalForm: row.legal_form,
    identifiers: identifiers
      .filter((item) => item.organisation_id === row.id)
      .map((item) => ({
        scheme: item.scheme,
        identifier: item.identifier,
        verified: item.verified_at !== null,
      })),
  }));
}

/** Name, legal form and identifiers with their verification, in the order of `ids`. Unknown ids are left out. */
export async function organisationSummaries(
  tx: Tx,
  ids: readonly string[],
): Promise<OrganisationSummary[]> {
  if (ids.length === 0) return [];
  const db = partyDb(tx);
  const rows = await db
    .selectFrom('party.organisation')
    .select(['id', 'name', 'legal_form'])
    .where('id', 'in', [...ids])
    .execute();
  const byId = new Map((await withIdentifiers(db, rows)).map((summary) => [summary.id, summary]));
  return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
}

const address = (row: {
  address_line1: string;
  address_line2: string | null;
  address_town: string;
  address_postcode: string;
  address_country_code: string;
}) => ({
  line1: row.address_line1,
  line2: row.address_line2,
  town: row.address_town,
  postcode: row.address_postcode,
  countryCode: row.address_country_code,
});

const ORGANISATION_COLUMNS = [
  'id',
  'name',
  'legal_form',
  'address_line1',
  'address_line2',
  'address_town',
  'address_postcode',
  'address_country_code',
  'website',
] as const;

/** One organisation as its contact sees it: no verification, no other contacts. */
export async function portalOrganisation(
  tx: Tx,
  organisationId: string,
): Promise<PortalOrganisation | null> {
  const db = partyDb(tx);
  const row = await db
    .selectFrom('party.organisation')
    .select(ORGANISATION_COLUMNS)
    .where('id', '=', organisationId)
    .executeTakeFirst();
  if (row === undefined) return null;
  const [summary] = await withIdentifiers(db, [row]);
  return {
    id: row.id,
    name: row.name,
    legalForm: row.legal_form,
    identifiers: (summary?.identifiers ?? []).map(({ scheme, identifier }) => ({
      scheme,
      identifier,
    })),
    registeredAddress: address(row),
    website: row.website,
  };
}

/** One organisation as staff see it, with its current contacts. */
export async function consoleOrganisation(
  tx: Tx,
  organisationId: string,
): Promise<ConsoleOrganisation | null> {
  const db = partyDb(tx);
  const row = await db
    .selectFrom('party.organisation')
    .select(ORGANISATION_COLUMNS)
    .where('id', '=', organisationId)
    .executeTakeFirst();
  if (row === undefined) return null;
  const [summary] = await withIdentifiers(db, [row]);
  const contacts = await db
    .selectFrom('party.relationship')
    .innerJoin('party.person', 'party.person.id', 'party.relationship.subject_id')
    .select([
      'party.person.id as person_id',
      'party.person.given_name',
      'party.person.family_name',
      'party.person.email',
    ])
    .where('party.relationship.type', '=', 'contact_for')
    .where('party.relationship.object_id', '=', organisationId)
    .where('party.relationship.ends_on', 'is', null)
    .orderBy('party.person.email')
    .execute();
  return {
    id: row.id,
    name: row.name,
    legalForm: row.legal_form,
    identifiers: summary?.identifiers ?? [],
    registeredAddress: address(row),
    website: row.website,
    contacts: contacts.map((contact) => ({
      personId: contact.person_id,
      givenName: contact.given_name,
      familyName: contact.family_name,
      email: contact.email,
    })),
  };
}

/** The organisations a person is a current contact for, by name. */
export async function organisationsOfContact(
  tx: Tx,
  personId: string,
): Promise<{ id: Id; name: string; legalForm: OrganisationSummary['legalForm'] }[]> {
  const rows = await partyDb(tx)
    .selectFrom('party.relationship')
    .innerJoin('party.organisation', 'party.organisation.id', 'party.relationship.object_id')
    .select(['party.organisation.id', 'party.organisation.name', 'party.organisation.legal_form'])
    .where('party.relationship.type', '=', 'contact_for')
    .where('party.relationship.subject_id', '=', personId)
    .where('party.relationship.ends_on', 'is', null)
    .orderBy('party.organisation.name')
    .orderBy('party.organisation.id')
    .execute();
  return rows.map((row) => ({ id: row.id, name: row.name, legalForm: row.legal_form }));
}

/** The values an identifier search could mean, as each register writes them. */
function identifierCandidates(search: string): string[] {
  const compact = search
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^GB-[A-Z]{2,3}-/, '');
  return [...new Set(identifierSchemeIds.map((scheme) => normaliseIdentifier(scheme, compact)))];
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const encodeCursor = (id: string): string =>
  Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url');

function decodeCursor(cursor: string): string | null {
  const hex = Buffer.from(cursor, 'base64url').toString('hex');
  return hex.length === 32 && encodeCursor(hex) === cursor
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : null;
}

/**
 * A page of organisations by name, searched by name or identifier. Returns
 * null if the cursor does not name an organisation in this tenant.
 */
export async function listOrganisations(
  tx: Tx,
  query: OrganisationQuery,
): Promise<OrganisationPage | null> {
  const db = partyDb(tx);
  let select = db
    .selectFrom('party.organisation')
    .select(['id', 'name', 'legal_form'])
    .orderBy('name')
    .orderBy('id')
    .limit(PAGE_SIZE + 1);

  const { search, cursor } = query;
  if (search !== undefined) {
    const candidates = identifierCandidates(search);
    select = select.where((eb) =>
      eb.or([
        eb('name', 'ilike', `%${escapeLike(search)}%`),
        eb.exists(
          eb
            .selectFrom('party.organisation_identifier')
            .select('id')
            .whereRef('party.organisation_identifier.organisation_id', '=', 'party.organisation.id')
            .where('identifier', 'in', candidates),
        ),
      ]),
    );
  }
  if (cursor !== undefined) {
    const id = decodeCursor(cursor);
    const after =
      id === null
        ? undefined
        : await db
            .selectFrom('party.organisation')
            .select(['id', 'name'])
            .where('id', '=', id)
            .executeTakeFirst();
    if (after === undefined) return null;
    select = select.where((eb) =>
      eb(eb.refTuple('name', 'id'), '>', eb.tuple(after.name, after.id)),
    );
  }

  const rows = await select.execute();
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    organisations: await withIdentifiers(db, page),
    nextCursor: rows.length > PAGE_SIZE && last !== undefined ? encodeCursor(last.id) : null,
  };
}
