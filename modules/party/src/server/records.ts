// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff changes to party records (ADR 0017, ADR 0025): details, identifiers
// and relationships, each with its value history in the caller's own
// transaction, so a change and its history stand or fall together. The
// acting member is the session's, passed in by the handler. A merged or
// erased party is never changed. Nothing here reads a tenant from a value:
// inserts take it from the transaction, and row-level security keeps every
// read inside it.

import {
  relationshipProblems,
  type ConsoleIdentifier,
  type ConsoleRelationship,
  type IdentifierInput,
  type ManagedOrganisation,
  type ManagedPerson,
  type OrganisationDetailsInput,
  type PartyKind,
  type PartyMessage,
  type ProfileInput,
  type RelationshipInput,
} from '../contracts/index.ts';
import { fieldChanges, writeHistory } from './history.ts';
import { organisationColumns } from './organisations.ts';
import { partyDb, type PartyDb, type Tx } from './tables.ts';

/** A party is `open` to change, or `closed` once merged or erased, or `missing` (or of another kind). */
export type PartyState = 'open' | 'closed' | 'missing';

/** Look at the party, then lock it against a merge for the rest of the transaction. */
export async function partyState(db: PartyDb, id: string, kind: PartyKind): Promise<PartyState> {
  const read = async (lock: boolean): Promise<PartyState> => {
    const query = db.selectFrom('party.party').select(['kind', 'status']).where('id', '=', id);
    const row = await (lock ? query.forShare() : query).executeTakeFirst();
    if (row === undefined || row.kind !== kind) return 'missing';
    return row.status === 'merged' || row.status === 'erased' ? 'closed' : 'open';
  };
  const seen = await read(false);
  return seen === 'open' ? read(true) : seen;
}

const blankAsNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** Audit changes naming the party columns a change touched, never their values. */
export const changedFieldIds = (changes: readonly { readonly field: string }[]) =>
  Object.fromEntries(changes.map(({ field }) => [`party.${field}`, {}]));

/** The database refused a second row where one value may appear once. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

/** Change an organisation's details. Returns the history written, none when nothing differs. */
export async function changeOrganisation(
  tx: Tx,
  memberId: string,
  id: string,
  input: OrganisationDetailsInput,
) {
  const db = partyDb(tx);
  const next = organisationColumns(input);
  const current = await db
    .selectFrom('party.organisation')
    .select(Object.keys(next) as (keyof typeof next)[])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const changes = fieldChanges('organisation', current, next);
  if (changes.length === 0) return changes;
  await db
    .updateTable('party.organisation')
    .set({ ...next, updated_by: memberId })
    .where('id', '=', id)
    .execute();
  await writeHistory(db, { id, kind: 'organisation' }, memberId, changes);
  return changes;
}

/** Change a person's name and phone number. The email address and the account link are not staff's to change. */
export async function changePerson(tx: Tx, memberId: string, id: string, input: ProfileInput) {
  const db = partyDb(tx);
  const next = {
    given_name: input.givenName,
    family_name: input.familyName,
    phone: blankAsNull(input.phone),
  };
  const current = await db
    .selectFrom('party.person')
    .select(['given_name', 'family_name', 'phone'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const changes = fieldChanges('person', current, next);
  if (changes.length === 0) return changes;
  await db
    .updateTable('party.person')
    .set({ ...next, updated_by: memberId })
    .where('id', '=', id)
    .execute();
  await writeHistory(db, { id, kind: 'person' }, memberId, changes);
  return changes;
}

/** The identifier as its register writes it, as value history keeps it. */
const orgIdForm = (scheme: string, identifier: string) => `${scheme}-${identifier}`;

/** Add an unverified identifier: its id, or null when the organisation has that scheme already. */
export async function addIdentifier(
  tx: Tx,
  memberId: string,
  organisationId: string,
  { scheme, identifier }: IdentifierInput,
): Promise<string | null> {
  const db = partyDb(tx);
  const held = await db
    .selectFrom('party.organisation_identifier')
    .select('id')
    .where('organisation_id', '=', organisationId)
    .where('scheme', '=', scheme)
    .executeTakeFirst();
  if (held !== undefined) return null;
  const row = await db
    .insertInto('party.organisation_identifier')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      organisation_id: organisationId,
      scheme,
      identifier,
      created_by: memberId,
      updated_by: memberId,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(db, { id: organisationId, kind: 'organisation' }, memberId, [
    { field: 'organisation.identifier', before: null, after: orgIdForm(scheme, identifier) },
  ]);
  return row.id;
}

/** The outcome of verifying: done now, verified already, no such identifier on the organisation, or the value is verified elsewhere. */
export async function verifyIdentifier(
  tx: Tx,
  memberId: string,
  organisationId: string,
  identifierId: string,
): Promise<'verified' | 'already' | 'missing' | 'taken'> {
  const db = partyDb(tx);
  const row = await db
    .selectFrom('party.organisation_identifier')
    .select(['scheme', 'identifier', 'verified_by'])
    .where('id', '=', identifierId)
    .where('organisation_id', '=', organisationId)
    .executeTakeFirst();
  if (row === undefined) return 'missing';
  if (row.verified_by !== null) return 'already';
  const elsewhere = await db
    .selectFrom('party.organisation_identifier')
    .select('id')
    .where('scheme', '=', row.scheme)
    .where('identifier', '=', row.identifier)
    .where('verified_by', 'is not', null)
    .executeTakeFirst();
  if (elsewhere !== undefined) return 'taken';
  // The time is the database's own; the verifier is this member, from the session.
  try {
    await db
      .updateTable('party.organisation_identifier')
      .set({ verified_by: memberId, updated_by: memberId })
      .where('id', '=', identifierId)
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) return 'taken';
    throw error;
  }
  return 'verified';
}

const fullName = (given: string | null, family: string | null): string | null =>
  [given, family].filter(Boolean).join(' ') || null;

/** An organisation as staff see it after a change, with every relationship. */
export async function managedOrganisation(tx: Tx, id: string): Promise<ManagedOrganisation | null> {
  const db = partyDb(tx);
  const row = await db
    .selectFrom('party.organisation')
    .select([
      'id',
      'name',
      'legal_form',
      'address_line1',
      'address_line2',
      'address_town',
      'address_postcode',
      'address_country_code',
      'website',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined) return null;
  return {
    id: row.id,
    name: row.name,
    legalForm: row.legal_form,
    registeredAddress: {
      line1: row.address_line1,
      line2: row.address_line2,
      town: row.address_town,
      postcode: row.address_postcode,
      countryCode: row.address_country_code,
    },
    website: row.website,
    identifiers: await consoleIdentifiers(db, id),
    relationships: await consoleRelationships(db, { partyId: id }),
  };
}

/** A person as staff see them after a change, with every relationship. */
export async function managedPerson(tx: Tx, id: string): Promise<ManagedPerson | null> {
  const db = partyDb(tx);
  const row = await db
    .selectFrom('party.person')
    .select(['id', 'given_name', 'family_name', 'email', 'phone'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined) return null;
  return {
    id: row.id,
    givenName: row.given_name,
    familyName: row.family_name,
    email: row.email,
    phone: row.phone,
    relationships: await consoleRelationships(db, { partyId: id }),
  };
}

/** One identifier of an organisation as staff see it. */
export async function consoleIdentifier(
  tx: Tx,
  organisationId: string,
  identifierId: string,
): Promise<ConsoleIdentifier | null> {
  const found = await consoleIdentifiers(partyDb(tx), organisationId, identifierId);
  return found[0] ?? null;
}

async function consoleIdentifiers(
  db: PartyDb,
  organisationId: string,
  identifierId?: string,
): Promise<ConsoleIdentifier[]> {
  let select = db
    .selectFrom('party.organisation_identifier as i')
    .leftJoin('app.membership as m', 'm.id', 'i.verified_by')
    .leftJoin('party.person as p', 'p.user_id', 'm.user_id')
    .select(['i.id', 'i.scheme', 'i.identifier', 'i.verified_at', 'i.verified_by'])
    .select(['p.given_name', 'p.family_name'])
    .where('i.organisation_id', '=', organisationId)
    .orderBy('i.scheme');
  if (identifierId !== undefined) select = select.where('i.id', '=', identifierId);
  return (await select.execute()).map((row) => ({
    id: row.id,
    scheme: row.scheme,
    identifier: row.identifier,
    verification:
      row.verified_at === null || row.verified_by === null
        ? null
        : {
            verifiedAt: row.verified_at.toISOString(),
            verifiedBy: row.verified_by,
            verifiedByName: fullName(row.given_name, row.family_name),
          },
  }));
}

/** Relationships of a party, or the one named, current and ended, oldest first. */
export async function consoleRelationships(
  db: PartyDb,
  which: { readonly partyId?: string; readonly id?: string },
): Promise<ConsoleRelationship[]> {
  let select = db
    .selectFrom('party.relationship as r')
    .leftJoin('party.person as p', 'p.id', 'r.subject_id')
    .leftJoin('party.organisation as o', 'o.id', 'r.object_id')
    .select(['r.id', 'r.type', 'r.subject_id', 'r.object_id', 'p.given_name', 'p.family_name'])
    .select(['o.name as organisation_name'])
    .select((eb) => [
      eb.cast<string | null>('r.starts_on', 'text').as('starts_on'),
      eb.cast<string | null>('r.ends_on', 'text').as('ends_on'),
    ])
    .orderBy('r.created_at')
    .orderBy('r.id');
  const { partyId, id } = which;
  if (id !== undefined) select = select.where('r.id', '=', id);
  if (partyId !== undefined) {
    select = select.where((eb) =>
      eb.or([eb('r.subject_id', '=', partyId), eb('r.object_id', '=', partyId)]),
    );
  }
  return (await select.execute()).map((row) => ({
    id: row.id,
    type: row.type,
    from: { id: row.subject_id, kind: 'person', name: fullName(row.given_name, row.family_name) },
    to: { id: row.object_id, kind: 'organisation', name: row.organisation_name },
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }));
}

/** What adding a relationship came to: its id, `existing` if it was current already, or the message to show. */
export type AddedLink =
  { readonly id: string; readonly existing: boolean } | { readonly refused: PartyMessage };

/** Add a person to an organisation, or answer the link that is current already. */
export async function addRelationship(
  tx: Tx,
  memberId: string,
  organisationId: string,
  input: RelationshipInput,
): Promise<AddedLink | 'missing' | 'closed'> {
  const db = partyDb(tx);
  const person = await partyState(db, input.personId, 'person');
  const wrongKind =
    person === 'missing' && (await partyState(db, input.personId, 'organisation')) !== 'missing';
  if (person !== 'open' && !wrongKind) return person;
  const refused = relationshipProblems({
    type: input.type,
    fromKind: wrongKind ? 'organisation' : 'person',
    toKind: 'organisation',
    startsOn: input.startsOn ?? null,
    endsOn: null,
  })[0];
  if (refused !== undefined) return { refused };
  const current = await db
    .selectFrom('party.relationship')
    .select('id')
    .where('type', '=', input.type)
    .where('subject_id', '=', input.personId)
    .where('object_id', '=', organisationId)
    .where('ends_on', 'is', null)
    .executeTakeFirst();
  if (current !== undefined) return { id: current.id, existing: true };
  const row = await db
    .insertInto('party.relationship')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      type: input.type,
      subject_id: input.personId,
      subject_kind: 'person',
      object_id: organisationId,
      object_kind: 'organisation',
      starts_on: input.startsOn ?? null,
      created_by: memberId,
      updated_by: memberId,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, existing: false };
}

/** End a relationship on a date. Refuses an end before the start, or a link that has ended. */
export async function endRelationship(
  tx: Tx,
  memberId: string,
  relationshipId: string,
  endsOn: string,
): Promise<'ended' | 'missing' | 'closed' | 'over' | { readonly refused: PartyMessage }> {
  const db = partyDb(tx);
  const row = await db
    .selectFrom('party.relationship')
    .select(['subject_id', 'object_id', 'ends_on'])
    .select((eb) => eb.cast<string | null>('starts_on', 'text').as('starts_on'))
    .where('id', '=', relationshipId)
    .executeTakeFirst();
  if (row === undefined) return 'missing';
  for (const [id, kind] of [
    [row.subject_id, 'person'],
    [row.object_id, 'organisation'],
  ] as const) {
    const state = await partyState(db, id, kind);
    if (state !== 'open') return state;
  }
  if (row.ends_on !== null) return 'over';
  const refused = relationshipProblems({
    type: 'contact_for',
    fromKind: 'person',
    toKind: 'organisation',
    startsOn: row.starts_on,
    endsOn,
  })[0];
  if (refused !== undefined) return { refused };
  await db
    .updateTable('party.relationship')
    .set({ ends_on: endsOn, updated_by: memberId })
    .where('id', '=', relationshipId)
    .execute();
  return 'ended';
}
