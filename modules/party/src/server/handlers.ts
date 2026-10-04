// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party routes' handlers (ADR 0017). The platform has already checked the
// session, the permission and the scope rule. The acting person is always the
// session's account, never a value from the request, and an audit event
// names ids and field ids, never personal values.

import type { AuditChanges } from '@pixel-scientists/db';
import type { Id } from '@pixel-scientists/domain';

import {
  partyRoutes,
  type Consent,
  type ConsentChange,
  type ConsoleOrganisation,
  type ConsolePerson,
  type OrganisationInput,
  type OrganisationPage,
  type OrganisationQuery,
  type PartyAuditAction,
  type PortalOrganisation,
  type PortalOrganisationList,
  type Profile,
  type ProfileInput,
} from '../contracts/index.ts';
import {
  consoleOrganisation,
  createOrganisation as insertOrganisation,
  listOrganisations as findOrganisations,
  organisationsOfContact,
  portalOrganisation,
  updateOrganisation,
} from './organisations.ts';
import {
  currentConsents,
  ensurePersonForUser,
  isCurrentContact,
  personIdForUser,
} from './people.ts';
import { partyDb, type Tx } from './tables.ts';

/** What the platform gives a handler for audit, bound to the request's transaction and actor. */
export interface PartyAudit {
  record(event: {
    readonly action: PartyAuditAction;
    readonly entityId: string;
    readonly changes?: AuditChanges;
  }): Promise<void>;
  read(entity: { readonly action: PartyAuditAction; readonly entityId: string }): Promise<void>;
}

/** What a handler reads from the request context. */
export interface PartyContext {
  readonly audit: PartyAudit;
  readonly session: { readonly userId: string; readonly email: () => Promise<string> };
  readonly membership: { readonly id: string };
}

/** What the platform passes in: a failure that reads exactly as a missing record does. */
export interface PartyDependencies {
  readonly notFound: () => Error;
}

interface Args<I> {
  readonly tx: Tx;
  readonly context: PartyContext;
  readonly input: I;
}

/** The field ids a change touched, with no values. */
function fieldIds(table: string, columns: readonly string[]): AuditChanges {
  return Object.fromEntries(columns.map((column) => [`${table}.${column}`, {}]));
}

const ORGANISATION_FIELDS = [
  'name',
  'legal_form',
  'address_line1',
  'address_line2',
  'address_town',
  'address_postcode',
  'address_country_code',
  'website',
] as const;

function organisationChanges(input: OrganisationInput): AuditChanges {
  return {
    ...fieldIds('party.organisation', ORGANISATION_FIELDS),
    ...(input.identifiers.length === 0
      ? {}
      : fieldIds('party.organisation_identifier', ['scheme', 'identifier'])),
  };
}

export function partyHandlers({ notFound }: PartyDependencies) {
  /** The caller's person, made from their account on the first request. */
  async function ownPerson(tx: Tx, context: PartyContext): Promise<Id> {
    const { userId, email } = context.session;
    const found = await personIdForUser(tx, userId);
    if (found !== null) return found;
    const { personId, created } = await ensurePersonForUser(tx, { userId, email: await email() });
    if (created) {
      await context.audit.record({
        action: 'party.person.created',
        entityId: personId,
        changes: fieldIds('party.person', ['email', 'user_id']),
      });
    }
    return personId;
  }

  async function profile(tx: Tx, personId: Id): Promise<Profile> {
    const db = partyDb(tx);
    const person = await db
      .selectFrom('party.person')
      .select(['given_name', 'family_name', 'email', 'phone'])
      .where('id', '=', personId)
      .executeTakeFirstOrThrow();
    return {
      givenName: person.given_name,
      familyName: person.family_name,
      email: person.email,
      phone: person.phone,
      consents: await currentConsents(db, personId),
    };
  }

  async function ownOrganisation(tx: Tx, organisationId: string): Promise<PortalOrganisation> {
    return (await portalOrganisation(tx, organisationId)) ?? Promise.reject(notFound());
  }

  async function getProfile({ tx, context }: Args<unknown>): Promise<Profile> {
    return profile(tx, await ownPerson(tx, context));
  }

  async function updateProfile({
    tx,
    context,
    input,
  }: Args<{ body: ProfileInput }>): Promise<Profile> {
    const personId = await ownPerson(tx, context);
    const { givenName, familyName, phone } = input.body;
    await partyDb(tx)
      .updateTable('party.person')
      .set({
        given_name: givenName,
        family_name: familyName,
        phone: phone === undefined || phone === '' ? null : phone,
        updated_by: context.membership.id,
      })
      .where('id', '=', personId)
      .execute();
    await context.audit.record({
      action: 'party.person.updated',
      entityId: personId,
      changes: fieldIds('party.person', ['given_name', 'family_name', 'phone']),
    });
    return profile(tx, personId);
  }

  async function recordConsent({
    tx,
    context,
    input,
  }: Args<{ body: ConsentChange }>): Promise<Consent> {
    const personId = await ownPerson(tx, context);
    const { purpose, channel, state, privacyNoticeVersion } = input.body;
    const row = await partyDb(tx)
      .insertInto('party.consent')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        person_id: personId,
        purpose,
        channel,
        state,
        privacy_notice_version: privacyNoticeVersion,
        source: 'portal',
        recorded_by: context.membership.id,
      }))
      .returning(['id', 'recorded_at'])
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'party.consent.recorded',
      entityId: row.id,
      changes: fieldIds('party.consent', ['purpose', 'channel', 'state', 'privacy_notice_version']),
    });
    return {
      purpose,
      channel,
      state,
      privacyNoticeVersion,
      recordedAt: row.recorded_at.toISOString(),
    };
  }

  async function listMyOrganisations({
    tx,
    context,
  }: Args<unknown>): Promise<PortalOrganisationList> {
    const personId = await ownPerson(tx, context);
    return { organisations: await organisationsOfContact(tx, personId) };
  }

  async function createOrganisation({
    tx,
    context,
    input,
  }: Args<{ body: OrganisationInput }>): Promise<PortalOrganisation> {
    const personId = await ownPerson(tx, context);
    const { organisationId, relationshipId } = await insertOrganisation(
      tx,
      { membershipId: context.membership.id },
      personId,
      input.body,
    );
    await context.audit.record({
      action: 'party.organisation.created',
      entityId: organisationId,
      changes: organisationChanges(input.body),
    });
    await context.audit.record({
      action: 'party.relationship.created',
      entityId: relationshipId,
      changes: fieldIds('party.relationship', ['type', 'subject_id', 'object_id']),
    });
    return ownOrganisation(tx, organisationId);
  }

  function getMyOrganisation({
    tx,
    input,
  }: Args<{ params: { organisationId: string } }>): Promise<PortalOrganisation> {
    return ownOrganisation(tx, input.params.organisationId);
  }

  async function updateMyOrganisation({
    tx,
    context,
    input,
  }: Args<{
    params: { organisationId: string };
    body: OrganisationInput;
  }>): Promise<PortalOrganisation> {
    const { organisationId } = input.params;
    const found = await updateOrganisation(
      tx,
      { membershipId: context.membership.id },
      organisationId,
      input.body,
    );
    if (!found) throw notFound();
    await context.audit.record({
      action: 'party.organisation.updated',
      entityId: organisationId,
      changes: organisationChanges(input.body),
    });
    return ownOrganisation(tx, organisationId);
  }

  async function listOrganisations({
    tx,
    input,
  }: Args<{ query: OrganisationQuery }>): Promise<OrganisationPage> {
    return (await findOrganisations(tx, input.query)) ?? Promise.reject(notFound());
  }

  async function getOrganisation({
    tx,
    context,
    input,
  }: Args<{ params: { organisationId: string } }>): Promise<ConsoleOrganisation> {
    const { organisationId } = input.params;
    const found = await consoleOrganisation(tx, organisationId);
    if (found === null) throw notFound();
    await context.audit.read({ action: 'party.organisation.viewed', entityId: organisationId });
    return found;
  }

  async function getPerson({
    tx,
    context,
    input,
  }: Args<{ params: { personId: string } }>): Promise<ConsolePerson> {
    const { personId } = input.params;
    const db = partyDb(tx);
    const person = await db
      .selectFrom('party.person')
      .select(['id', 'given_name', 'family_name', 'email', 'phone'])
      .where('id', '=', personId)
      .executeTakeFirst();
    if (person === undefined) throw notFound();
    await context.audit.read({ action: 'party.person.viewed', entityId: personId });
    return {
      id: person.id,
      givenName: person.given_name,
      familyName: person.family_name,
      email: person.email,
      phone: person.phone,
      organisations: (await organisationsOfContact(tx, personId)).map(({ id, name }) => ({
        id,
        name,
      })),
      consents: await currentConsents(db, personId),
    };
  }

  return {
    getProfile,
    updateProfile,
    recordConsent,
    listMyOrganisations,
    createOrganisation,
    getMyOrganisation,
    updateMyOrganisation,
    listOrganisations,
    getOrganisation,
    getPerson,
  };
}

/** Scope rules for the portal routes (ADR 0004). */
export const partyResolvers = {
  /**
   * The caller's own person, which every `own_person` route finds or creates
   * from the session and never takes from the request. No person exists
   * before the first visit, so there is nothing to refuse here.
   */
  own_person: (): Promise<boolean> => Promise.resolve(true),

  /** An organisation the session's person is a current contact for. */
  own_organisation: async ({
    tx,
    userId,
    input,
  }: {
    readonly tx: Tx;
    readonly userId: string;
    readonly input: { readonly params: unknown };
  }): Promise<boolean> => {
    const params = partyRoutes.getMyOrganisation.params.safeParse(input.params);
    if (!params.success) return false;
    const personId = await personIdForUser(tx, userId);
    return personId !== null && isCurrentContact(tx, personId, params.data.organisationId);
  },
};
