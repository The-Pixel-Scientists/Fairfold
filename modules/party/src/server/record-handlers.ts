// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The handlers for the staff routes that change party records (ADR 0017,
// ADR 0025). The platform has already checked the session, `party.records.manage`
// and the tenant scope. The acting member is the session's, and an audit
// event names ids and field ids, never a value. An id from another tenant
// reads as a missing one.

import type { Id } from '@pixel-scientists/domain';

import {
  partyMessages,
  type ConsoleIdentifier,
  type ConsoleRelationship,
  type EndRelationship,
  type IdentifierInput,
  type ManagedOrganisation,
  type ManagedPerson,
  type OrganisationDetailsInput,
  type PartyKind,
  type ProfileInput,
  type RelationshipInput,
  type ValueHistoryPage,
} from '../contracts/index.ts';
import type { PartyContext } from './handlers.ts';
import { readHistory } from './history.ts';
import {
  addIdentifier,
  addRelationship,
  changedFieldIds,
  changeOrganisation,
  changePerson,
  consoleIdentifier,
  consoleRelationships,
  endRelationship,
  managedOrganisation,
  managedPerson,
  partyState,
  verifyIdentifier,
} from './records.ts';
import { partyDb, type Tx } from './tables.ts';

export interface PartyRecordDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A request the caller can fix, in words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
}

interface Args<I> {
  readonly tx: Tx;
  readonly context: PartyContext;
  readonly input: I;
}

interface HistoryQuery {
  readonly cursor?: string | undefined;
}

const closedRecord =
  "This record has been merged into another or erased, so it can't be changed. Open the record it was merged into.";
const relationshipOver = 'This relationship has already ended.';

export function partyRecordHandlers({ notFound, refuse }: PartyRecordDependencies) {
  /** The party is here and still open to change; locks it against a merge until the request ends. */
  async function writable(tx: Tx, id: string, kind: PartyKind): Promise<void> {
    const state = await partyState(partyDb(tx), id, kind);
    if (state === 'missing') throw notFound();
    if (state === 'closed') throw refuse(409, closedRecord);
  }

  const found = <T>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw notFound();
    return value;
  };

  async function updateOrganisation({
    tx,
    context,
    input,
  }: Args<{
    params: { organisationId: string };
    body: OrganisationDetailsInput;
  }>): Promise<ManagedOrganisation> {
    const { organisationId } = input.params;
    await writable(tx, organisationId, 'organisation');
    const changes = await changeOrganisation(tx, context.membership.id, organisationId, input.body);
    if (changes.length > 0) {
      await context.audit.record({
        action: 'party.organisation.updated',
        entityId: organisationId,
        changes: changedFieldIds(changes),
      });
    }
    return found(await managedOrganisation(tx, organisationId));
  }

  async function updatePerson({
    tx,
    context,
    input,
  }: Args<{ params: { personId: string }; body: ProfileInput }>): Promise<ManagedPerson> {
    const { personId } = input.params;
    await writable(tx, personId, 'person');
    const changes = await changePerson(tx, context.membership.id, personId, input.body);
    if (changes.length > 0) {
      await context.audit.record({
        action: 'party.person.updated',
        entityId: personId,
        changes: changedFieldIds(changes),
      });
    }
    return found(await managedPerson(tx, personId));
  }

  async function addOrganisationIdentifier({
    tx,
    context,
    input,
  }: Args<{
    params: { organisationId: string };
    body: IdentifierInput;
  }>): Promise<ConsoleIdentifier> {
    const { organisationId } = input.params;
    await writable(tx, organisationId, 'organisation');
    const id = await addIdentifier(tx, context.membership.id, organisationId, input.body);
    if (id === null) throw refuse(409, partyMessages.identifierOncePerType);
    await context.audit.record({
      action: 'party.identifier.added',
      entityId: organisationId,
      changes: {
        'party.organisation_identifier.scheme': {},
        'party.organisation_identifier.identifier': {},
      },
    });
    return found(await consoleIdentifier(tx, organisationId, id));
  }

  async function verifyOrganisationIdentifier({
    tx,
    context,
    input,
  }: Args<{
    params: { organisationId: string; identifierId: string };
  }>): Promise<ConsoleIdentifier> {
    const { organisationId, identifierId } = input.params;
    await writable(tx, organisationId, 'organisation');
    const outcome = await verifyIdentifier(tx, context.membership.id, organisationId, identifierId);
    if (outcome === 'missing') throw notFound();
    if (outcome === 'taken') throw refuse(409, partyMessages.identifierAlreadyVerified);
    if (outcome === 'verified') {
      await context.audit.record({
        action: 'party.identifier.verified',
        entityId: organisationId,
        changes: { 'party.organisation_identifier.verified_by': {} },
      });
    }
    return found(await consoleIdentifier(tx, organisationId, identifierId));
  }

  async function addOrganisationContact({
    tx,
    context,
    input,
  }: Args<{
    params: { organisationId: string };
    body: RelationshipInput;
  }>): Promise<ConsoleRelationship> {
    const { organisationId } = input.params;
    await writable(tx, organisationId, 'organisation');
    const added = await addRelationship(tx, context.membership.id, organisationId, input.body);
    if (added === 'missing') throw notFound();
    if (added === 'closed') throw refuse(409, closedRecord);
    if ('refused' in added) throw refuse(400, added.refused);
    if (!added.existing) {
      await context.audit.record({
        action: 'party.relationship.created',
        entityId: added.id,
        changes: {
          'party.relationship.type': {},
          'party.relationship.subject_id': {},
          'party.relationship.object_id': {},
        },
      });
    }
    return found((await consoleRelationships(partyDb(tx), { id: added.id }))[0]);
  }

  async function endContact({
    tx,
    context,
    input,
  }: Args<{
    params: { relationshipId: string };
    body: EndRelationship;
  }>): Promise<ConsoleRelationship> {
    const { relationshipId } = input.params;
    const outcome = await endRelationship(
      tx,
      context.membership.id,
      relationshipId,
      input.body.endsOn,
    );
    if (outcome === 'missing') throw notFound();
    if (outcome === 'closed') throw refuse(409, closedRecord);
    if (outcome === 'over') throw refuse(409, relationshipOver);
    if (typeof outcome === 'object') throw refuse(400, outcome.refused);
    await context.audit.record({
      action: 'party.relationship.ended',
      entityId: relationshipId,
      changes: { 'party.relationship.ends_on': {} },
    });
    return found((await consoleRelationships(partyDb(tx), { id: relationshipId }))[0]);
  }

  /** A page of a party's history, which holds old personal values: read it, then audit the read. */
  async function history(
    { tx, context, input }: Args<{ query: HistoryQuery }>,
    partyId: Id,
    kind: PartyKind,
  ): Promise<ValueHistoryPage> {
    if ((await partyState(partyDb(tx), partyId, kind)) === 'missing') throw notFound();
    const page = found(await readHistory(tx, partyId, input.query.cursor));
    await context.audit.read({ action: 'party.value_history.viewed', entityId: partyId });
    return page;
  }

  return {
    updateOrganisation,
    updatePerson,
    addIdentifier: addOrganisationIdentifier,
    verifyIdentifier: verifyOrganisationIdentifier,
    addRelationship: addOrganisationContact,
    endRelationship: endContact,
    getOrganisationHistory: (args: Args<{ params: { organisationId: Id }; query: HistoryQuery }>) =>
      history(args, args.input.params.organisationId, 'organisation'),
    getPersonHistory: (args: Args<{ params: { personId: Id }; query: HistoryQuery }>) =>
      history(args, args.input.params.personId, 'person'),
  };
}
