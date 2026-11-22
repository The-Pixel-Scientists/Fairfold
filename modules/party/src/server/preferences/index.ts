// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A signed-in person's contact preferences (ADR 0033). The person is the
// session's own account, never a value from the request. A read gives the
// state for every purpose and portal channel from party.current_consent,
// where a suppression that applies reads as withdrawn. A change appends one
// consent row from the portal when it differs from that state, with its audit
// event in the same transaction; it never touches a suppression, and a grant
// after an unsubscribe is a new row that lifts it.

import type { DB } from '@pixel-scientists/db/generated/party';
import type { Id } from '@pixel-scientists/domain';

import {
  consentPurposes,
  portalConsentChannels,
  type ConsentChange,
  type Preferences,
} from '../../contracts/index.ts';
import type { PartyContext } from '../handlers.ts';
import { ensurePersonForUser, personIdForUser } from '../people.ts';
import { partyDb, type Tx } from '../tables.ts';

interface Args<I> {
  readonly tx: Tx;
  readonly context: PartyContext;
  readonly input: I;
}

type State = Preferences['preferences'][number]['state'];

const kind = (c: { purpose: string; channel: string }): string => `${c.purpose}:${c.channel}`;

const CONSENT_FIELDS = ['purpose', 'channel', 'state', 'privacy_notice_version'] as const;

async function readPreferences(tx: Tx, personId: Id | null): Promise<Preferences> {
  const current =
    personId === null
      ? []
      : await tx
          .$extendTables<Pick<DB, 'party.current_consent'>>()
          .selectFrom('party.current_consent')
          .select(['purpose', 'channel', 'state', 'suppressed', 'recorded_at'])
          .where('person_id', '=', personId)
          .execute();
  return {
    preferences: consentPurposes.flatMap((purpose) =>
      portalConsentChannels.map((channel) => {
        const row = current.find((c) => c.purpose === purpose && c.channel === channel);
        const state: State =
          row === undefined ? null : row.suppressed === true ? 'withdrawn' : (row.state as State);
        return { purpose, channel, state, recordedAt: row?.recorded_at?.toISOString() ?? null };
      }),
    ),
  };
}

export function preferenceHandlers() {
  async function getPreferences({ tx, context }: Args<unknown>): Promise<Preferences> {
    return readPreferences(tx, await personIdForUser(tx, context.session.userId));
  }

  async function changePreference({
    tx,
    context,
    input,
  }: Args<{ body: ConsentChange }>): Promise<Preferences> {
    const { userId, email } = context.session;
    let personId = await personIdForUser(tx, userId);
    if (personId === null) {
      const made = await ensurePersonForUser(tx, { userId, email: await email() });
      personId = made.personId;
      if (made.created) {
        await context.audit.record({
          action: 'party.person.created',
          entityId: personId,
          changes: Object.fromEntries(
            ['email', 'user_id'].map((column) => [`party.person.${column}`, {}]),
          ),
        });
      }
    }
    const { purpose, channel, state, privacyNoticeVersion } = input.body;
    const before = await readPreferences(tx, personId);
    const current = before.preferences.find((p) => kind(p) === kind(input.body));
    if (current?.state === state) return before;

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
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'party.consent.recorded',
      entityId: row.id,
      changes: Object.fromEntries(CONSENT_FIELDS.map((column) => [`party.consent.${column}`, {}])),
    });
    return readPreferences(tx, personId);
  }

  return { getPreferences, changePreference };
}
