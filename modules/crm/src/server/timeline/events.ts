// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The two events crm listens to (ADR 0016, ADR 0034), each adding a timeline
// item by reference. The platform runs this as the worker in the event's
// tenant transaction, after parseEvent(), for crm's queue. Nothing is trusted
// of the payload beyond ids: the people and the time come from grants' read
// contract, so a decision that is not released adds nothing (architecture
// rule 8), and a source that is gone ends the job with `missing`, which the
// platform turns into a job error code rather than a retry. A replayed event
// inserts nothing, through the table's unique key (S12-25's interaction_event). With crm off for the
// tenant the handler writes nothing, and turning it on does not backfill.
// No handler changes a status in another module (rule 9).

import { applicationSubmitted, decisionReleased } from '@pixel-scientists/grants/contracts';
import type { EventEnvelope } from '@pixel-scientists/domain/events';

import type { InteractionKind } from '../../contracts/index.ts';
import type { Tx } from '../context.ts';
import { crmEnabled } from '../import/context.ts';
import type { PartyReads } from '../parties.ts';
import { interactionDb } from './tables.ts';

/** What grants says now about an application or a decision, in the same tenant. */
export interface GrantsReads {
  /** Null when it is not there or is still a draft. */
  application(
    tx: Tx,
    applicationId: string,
  ): Promise<{
    readonly organisationId: string;
    readonly applicantPersonId: string;
    readonly submittedAt: Date;
  } | null>;
  /** Null when it is not there; `releasedAt` is null until it is released. */
  releasedDecision(
    tx: Tx,
    decisionId: string,
  ): Promise<{
    readonly organisationId: string;
    readonly recipientPersonId: string;
    readonly releasedAt: Date | null;
  } | null>;
}

export interface TimelineEventDependencies {
  readonly grants: GrantsReads;
  readonly parties: Pick<PartyReads, 'facts'>;
  /**
   * Runs `work` in a savepoint and reports whether it finished, undoing it if it threw: the db
   * package's `attempt`. A replayed event meets the table's unique key and is dropped this way,
   * since the worker holds no SELECT right on the table for an ON CONFLICT clause to name it.
   */
  readonly attempt: (tx: Tx, work: () => Promise<void>) => Promise<boolean>;
  /** The record an id reaches through any merge, as party's resolve contract answers; null if not here. */
  readonly resolveParty: (tx: Tx, partyId: string) => Promise<string | null>;
}

export type EventOutcome = 'recorded' | 'off' | 'missing' | 'not_released' | 'ignored';

export function timelineEvents(deps: TimelineEventDependencies) {
  /** One item on each party's timeline; a party that is erased or gone has none. */
  async function add(
    tx: Tx,
    item: {
      kind: InteractionKind;
      entityType: 'grants.application' | 'grants.decision';
      entityId: string;
      occurredAt: Date;
    },
    partyIds: readonly string[],
  ): Promise<void> {
    for (const id of new Set(partyIds)) {
      const partyId = await deps.resolveParty(tx, id);
      if (partyId === null) continue;
      const [party] = await deps.parties.facts(tx, [partyId]);
      if (party === undefined || party.status === 'erased') continue;
      await deps.attempt(tx, async () => {
        await interactionDb(tx)
          .insertInto('crm.interaction')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            party_id: partyId,
            kind: item.kind,
            occurred_at: item.occurredAt,
            source_module: 'grants',
            source_entity_type: item.entityType,
            source_entity_id: item.entityId,
          }))
          .execute();
      });
    }
  }

  return async function onEvent(tx: Tx, envelope: EventEnvelope): Promise<EventOutcome> {
    if (envelope.type === applicationSubmitted.name) {
      const { applicationId } = applicationSubmitted.data.parse(envelope.data);
      if (!(await crmEnabled(tx))) return 'off';
      const application = await deps.grants.application(tx, applicationId);
      if (application === null) return 'missing';
      await add(
        tx,
        {
          kind: 'application_submitted',
          entityType: 'grants.application',
          entityId: applicationId,
          occurredAt: application.submittedAt,
        },
        [application.organisationId, application.applicantPersonId],
      );
      return 'recorded';
    }
    if (envelope.type === decisionReleased.name) {
      const { decisionId } = decisionReleased.data.parse(envelope.data);
      if (!(await crmEnabled(tx))) return 'off';
      const decision = await deps.grants.releasedDecision(tx, decisionId);
      if (decision === null) return 'missing';
      if (decision.releasedAt === null) return 'not_released';
      await add(
        tx,
        {
          kind: 'decision_released',
          entityType: 'grants.decision',
          entityId: decisionId,
          occurredAt: decision.releasedAt,
        },
        [decision.organisationId, decision.recipientPersonId],
      );
      return 'recorded';
    }
    return 'ignored';
  };
}
