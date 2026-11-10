// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Everything the tenant holds about one person (ADR 0027): every module's
// contribution for each party in the person's merge set (ADR 0025), the
// memberships of the accounts those people's records name and the rows made
// through them, and the audit events about the set or done by those
// memberships, all read in the caller's transaction.

import type { Transaction } from '@pixel-scientists/db';

import type { SubjectAccessData } from './export-file.ts';
import { platformData, subjectAuditEvents } from './platform-data.ts';
import { collectModuleData, type Contribution } from './registry.ts';

/** The party server's merge set of a party: its survivor and every party merged into it. */
export type MergeSet = (tx: Transaction<unknown>, partyId: string) => Promise<readonly string[]>;

export async function collectSubjectAccess(
  tx: Transaction<unknown>,
  contributions: readonly Contribution[],
  mergeSet: MergeSet,
  subjectPartyId: string,
): Promise<SubjectAccessData> {
  const partyIds = await mergeSet(tx, subjectPartyId);
  const modules = await collectModuleData(tx, contributions, partyIds);
  const userIds = [
    ...new Set(
      (modules.party?.['party.person'] ?? []).flatMap((row) => {
        const userId = row['party.person.user_id']?.value;
        return typeof userId === 'string' ? [userId] : [];
      }),
    ),
  ];
  const platform = userIds.length === 0 ? undefined : await platformData(tx, userIds);
  return {
    modules: platform ? { ...modules, platform: platform.data } : modules,
    auditEvents: await subjectAuditEvents(tx, partyIds, platform?.membershipIds ?? []),
  };
}
