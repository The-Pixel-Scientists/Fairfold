// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The lookup routes' handlers (ADR 0031), for staff only. The platform has
// already checked the session, the permission and that assure is on; every
// input is checked again here. Nothing here calls a register: a refresh
// queues a job in the request's transaction. A record the caller may not
// reach reads exactly as a missing one does. The audit events hold the
// register and codes, with the organisation as the subject (the person, for a
// link), never a name.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';
import { organisationSummaries } from '@pixel-scientists/party/server';

import {
  lookupRefreshInputSchema,
  officerLinkInputSchema,
  registries,
  registryIds,
  type AssureAuditAction,
  type OrganisationLookups,
  type Registry,
} from '../../contracts/index.ts';
import { isMissingReference, isRefusedByRule } from '../checklists/context.ts';
import type { RegistryAdapters } from './adapters.ts';
import type { QueueRefresh } from './refresh.ts';
import {
  latestSnapshot,
  linkOfficer,
  lockOfficer,
  organisationIsErased,
  snapshotOfficers,
  snapshotOrganisation,
} from './store.ts';

type Tx = Transaction<unknown>;

/** What a handler reads from the request context. */
export interface RegistryContext {
  readonly requestId: string;
  readonly audit: {
    record(event: {
      readonly action: AssureAuditAction;
      readonly entityId: string;
      readonly subjectPartyId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
    read(entity: {
      readonly action: AssureAuditAction;
      readonly entityId: string;
      readonly subjectPartyId: string;
    }): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

export interface RegistryDependencies {
  readonly adapters: RegistryAdapters;
  /** Queues the refresh job in the request's transaction. */
  readonly queueRefresh: QueueRefresh;
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
}

interface Args<I> {
  readonly tx: Tx;
  readonly context: RegistryContext;
  readonly input: I;
}

/** The identifier an organisation claims on a register, or undefined. */
const claimed = (
  identifiers: readonly { readonly scheme: string; readonly identifier: string }[],
  registry: Registry,
): string | undefined =>
  identifiers.find(({ scheme }) => scheme === registries[registry])?.identifier;

export function registryHandlers(deps: RegistryDependencies) {
  const idOrNotFound = (value: unknown): string => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw deps.notFound();
    return parsed.data;
  };

  return {
    /** The newest snapshot of each identifier the organisation claims. Officers' names are not here. */
    listOrganisationLookups: async ({
      tx,
      input,
    }: Args<{ params: { organisationId: string } }>): Promise<OrganisationLookups> => {
      const organisationId = idOrNotFound(input.params.organisationId);
      const [organisation] = await organisationSummaries(tx, [organisationId]);
      if (organisation === undefined) throw deps.notFound();
      const snapshots = [];
      for (const registry of registryIds) {
        const identifier = claimed(organisation.identifiers, registry);
        if (identifier === undefined) continue;
        const snapshot = await latestSnapshot(tx, organisationId, registry, identifier);
        if (snapshot !== null) snapshots.push(snapshot);
      }
      return {
        snapshots,
        notSetUp: registryIds.filter((registry) => deps.adapters[registry] === undefined),
      };
    },

    /** Queues a fresh lookup of an identifier the organisation already claims. */
    refreshOrganisationLookup: async ({
      tx,
      context,
      input,
    }: Args<{ params: { organisationId: string }; body: unknown }>) => {
      const organisationId = idOrNotFound(input.params.organisationId);
      const body = lookupRefreshInputSchema.safeParse(input.body);
      if (!body.success) throw deps.refuse(400, 'Choose a register to look up.');
      const { registry } = body.data;
      const [organisation] = await organisationSummaries(tx, [organisationId]);
      if (organisation === undefined) throw deps.notFound();
      if (claimed(organisation.identifiers, registry) === undefined) {
        throw deps.refuse(409, 'This organisation has no identifier for that register.');
      }
      if (await organisationIsErased(tx, organisationId)) {
        throw deps.refuse(409, "This organisation has been erased, so it can't be looked up.");
      }
      const jobId = await deps.queueRefresh(
        tx,
        { organisationId, registry },
        { requestId: context.requestId, causingUserId: context.membership.id },
      );
      if (jobId === null) throw deps.refuse(409, 'A lookup for this register is already queued.');
      await context.audit.record({
        action: 'assure.lookup.refresh_requested',
        entityId: jobId,
        subjectPartyId: organisationId,
        changes: { 'assure.lookup_snapshot.registry': { after: registry } },
      });
      return { jobId, registry, queuedAt: new Date().toISOString() };
    },

    /** A snapshot's officers by name and role: personal data, so each read is audited. */
    listLookupOfficers: async ({
      tx,
      context,
      input,
    }: Args<{ params: { snapshotId: string } }>) => {
      const snapshotId = idOrNotFound(input.params.snapshotId);
      const organisationId = await snapshotOrganisation(tx, snapshotId);
      if (organisationId === null) throw deps.notFound();
      await context.audit.read({
        action: 'assure.lookup.officers_viewed',
        entityId: snapshotId,
        subjectPartyId: organisationId,
      });
      return { officers: await snapshotOfficers(tx, snapshotId) };
    },

    /** Links an officer to the person a member says they are, once; the person is the audit event's subject. */
    linkLookupOfficer: async ({
      tx,
      context,
      input,
    }: Args<{ params: { officerId: string }; body: unknown }>) => {
      const officerId = idOrNotFound(input.params.officerId);
      const body = officerLinkInputSchema.safeParse(input.body);
      if (!body.success) throw deps.refuse(400, 'Choose the person this officer is.');
      const officer = await lockOfficer(tx, officerId);
      if (officer === null) throw deps.notFound();
      if (officer.personId !== null) {
        throw deps.refuse(409, 'This officer is already linked to a person.');
      }
      const { personId } = body.data;
      let linked;
      try {
        linked = await linkOfficer(tx, officerId, personId, context.membership.id);
      } catch (error) {
        if (isMissingReference(error)) throw deps.refuse(400, 'Choose a person from your records.');
        if (isRefusedByRule(error)) {
          throw deps.refuse(409, "This person has been erased, so they can't be linked.");
        }
        throw error;
      }
      await context.audit.record({
        action: 'assure.lookup_officer.linked',
        entityId: officerId,
        subjectPartyId: personId,
      });
      return linked;
    },
  };
}
