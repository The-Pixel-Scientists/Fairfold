// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Searching organisations and people (ADR 0025). The term comes from the
// request body, is normalised, and goes to party's search as a parameter: it
// is never logged, audited or put in a problem, and no cursor holds it. A
// merged party answers its survivor's id, and an erased one only its status.
// A page holding a person writes `crm.party.found` for each of them, with
// that person as the subject. The console's search across tools is party's
// own providers, so crm adds none.

import { normaliseSearchTerm } from '@pixel-scientists/domain/platform/search';
import type { PartyKind } from '@pixel-scientists/party/contracts';

import type { PartySearchPage, PartyStatus, VerificationState } from '../contracts/index.ts';
import { crmDb, nextCursor, readCursor, type Args, type CrmDependencies } from './context.ts';

/** The search body as the route's schema leaves it. */
export interface SearchBody {
  readonly term: string;
  readonly kinds?: readonly PartyKind[] | undefined;
  readonly statuses?: readonly PartyStatus[] | undefined;
  readonly verification?: VerificationState | undefined;
  readonly listId?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/** The furthest a search reads into its results; a narrower term finds the rest. */
const MAX_OFFSET = 1000;

/** What an erased record shows: its status, and nothing it held. */
const ERASED_LABEL = 'Erased record';

/** A label cut to the contract's limit, ending in an ellipsis and never half a character. */
function clip(label: string): string {
  if (label.length <= 200) return label;
  const cut = label.slice(0, 199);
  const last = cut.charCodeAt(cut.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}…`;
}

export function searchHandlers(deps: CrmDependencies) {
  async function searchParties({
    tx,
    context,
    input,
  }: Args<{ body: SearchBody }>): Promise<PartySearchPage> {
    const { kinds, statuses, verification, listId, cursor, limit } = input.body;
    const offset = readCursor(cursor, deps);
    if (offset > MAX_OFFSET) throw deps.refuse(400, 'Narrow your search to see more results.');
    const size = offset + limit + 1;

    let among: string[] | undefined;
    if (listId !== undefined) {
      const members = await crmDb(tx)
        .selectFrom('crm.list_member')
        .select('party_id')
        .where('list_id', '=', listId)
        .execute();
      among = members.map((member) => member.party_id);
    }
    const found =
      among?.length === 0
        ? []
        : await deps.parties.search(tx, {
            term: normaliseSearchTerm(input.body.term),
            kinds: kinds ?? ['organisation', 'person'],
            statuses: statuses ?? ['active'],
            verification,
            among,
            limit: size,
          });

    const page = [...found]
      .sort(
        (a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
      )
      .slice(offset, offset + limit)
      .map((hit) => ({ ...hit, id: hit.mergedInto ?? hit.id }));
    for (const hit of page.filter(({ kind }) => kind === 'person')) {
      await context.audit.read({
        action: 'crm.party.found',
        entityId: hit.id,
        subjectPartyId: hit.id,
      });
    }
    return {
      results: page.map(({ id, kind, label, status, verification }) => ({
        id,
        kind,
        label: status === 'erased' ? ERASED_LABEL : clip(label),
        status,
        verification,
      })),
      nextCursor: nextCursor(offset, found.length - offset, limit),
    };
  }

  return { searchParties };
}
