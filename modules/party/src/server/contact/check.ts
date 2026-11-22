// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether a person may be contacted, and where (ADR 0033). It runs in the
// sender's tenant transaction, at the moment of sending, and only reads. A
// marketing message needs the latest consent for its purpose and channel to
// be given, with no suppression in force; the one query reads both through
// party.current_consent. A transactional message needs no consent, but an
// erased person or one with no address is still refused. Anything the check
// cannot tell is refused, never allowed. Known gap (ADR 0033 says more):
// suppressions are matched by person only. A `bounced` suppression, which
// party.current_consent leaves out, and an unsubscribe or complaint on the
// same address hash under another person, are not yet checked. Matching
// needs the suppression key and the bounce release table, so it is
// deferred; check.integration.test.ts pins today's answers. Only email is sent today, and the
// worker reads no other contact point.

import type { Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/party';

import {
  mayContactInputSchema,
  type MayContact,
  type MayContactInput,
} from '../../contracts/index.ts';

type Tx = Transaction<unknown>;

const partyDb = (tx: Tx) => tx.$extendTables<Omit<DB, never>>();

const refuse = (code: Extract<MayContact, { allowed: false }>['code']): MayContact => ({
  allowed: false,
  code,
});

/**
 * Not allowed with `no_consent` when the input is not valid, and with
 * `person_erased` when the person is not in the transaction's tenant, so
 * the answer for another tenant's person is the same as for an erased one.
 */
export async function mayContact(tx: Tx, input: MayContactInput): Promise<MayContact> {
  const parsed = mayContactInputSchema.safeParse(input);
  if (!parsed.success) return refuse('no_consent');
  const { personId, channel, message } = parsed.data;

  const row = await partyDb(tx)
    .selectFrom('party.person as p')
    .leftJoin('party.current_consent as c', (join) =>
      join
        .onRef('c.person_id', '=', 'p.id')
        .on('c.channel', '=', channel)
        .on('c.purpose', '=', message.kind === 'marketing' ? message.purpose : null),
    )
    .select((eb) => [
      'p.email',
      'c.state',
      'c.suppressed',
      eb
        .fn<boolean>('party.is_erased', [eb.fn('app.current_tenant_id', []), eb.ref('p.id')])
        .as('erased'),
    ])
    .where('p.id', '=', personId)
    .executeTakeFirst();

  if (row === undefined || row.erased) return refuse('person_erased');
  if (channel !== 'email' || row.email === '') return refuse('no_contact_point');
  if (message.kind === 'transactional') return { allowed: true };
  if (row.suppressed === true) return refuse('suppressed');
  if (row.state === 'withdrawn') return refuse('consent_withdrawn');
  return row.state === 'given' ? { allowed: true } : refuse('no_consent');
}

/** The address and tenant a message to this person goes to, never taken from the caller; null if none. */
export async function emailRecipient(
  tx: Tx,
  personId: string,
): Promise<{ tenantId: string; address: string } | null> {
  const row = await partyDb(tx)
    .selectFrom('party.person')
    .select(['tenant_id', 'email'])
    .where('id', '=', personId)
    .executeTakeFirst();
  return row === undefined ? null : { tenantId: row.tenant_id, address: row.email };
}
