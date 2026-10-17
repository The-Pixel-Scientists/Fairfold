// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 360Giving file as the contract defines it (contracts/export/360giving.ts):
// one grant for each released award, built from its decision, round,
// programme and the recipient's organisation summary, and checked against the
// contract's schema before anything is sent. A file that fails the check is
// never sent in part.

import type { OrganisationSummary } from '@pixel-scientists/party/contracts';

import {
  amountAwarded,
  grantIdentifier,
  recipientOrganization,
  threeSixtyGivingExportSchema,
  type PublisherSetting,
  type ThreeSixtyGivingExport,
} from '../../contracts/index.ts';
import { localAt } from '../programme/time.ts';

/** What one released award is built from. */
export interface AwardRow {
  readonly application_id: string;
  readonly organisation_id: string;
  readonly amount_minor: string | null;
  readonly currency: 'GBP' | null;
  readonly released_at: Date | null;
  readonly decision_updated_at: Date;
  readonly round_title: string;
  readonly round_updated_at: Date;
  readonly programme_title: string;
  readonly programme_summary: string;
  readonly programme_updated_at: Date;
}

/** A file that does not match its schema. The code is all that is logged, never a value. */
export class ExportInvalid extends Error {
  readonly code = 'export_invalid';

  constructor() {
    super('The 360Giving file did not match its schema.');
  }
}

export function buildExport(
  rows: readonly AwardRow[],
  publisher: Pick<PublisherSetting, 'funderIdentifier' | 'funderName' | 'identifierPrefix'>,
  organisations: ReadonlyMap<string, Pick<OrganisationSummary, 'id' | 'name' | 'identifiers'>>,
  timeZone: string,
): ThreeSixtyGivingExport {
  const unverified = new Map<string, { id: string; name: string }>();
  const grants = rows.map((row) => {
    const organisation = organisations.get(row.organisation_id);
    if (organisation === undefined || row.released_at === null || row.currency === null) {
      throw new ExportInvalid();
    }
    const { recipient, verified } = recipientOrganization(publisher.identifierPrefix, organisation);
    if (!verified)
      unverified.set(organisation.id, { id: organisation.id, name: organisation.name });
    const modified = Math.max(
      row.decision_updated_at.getTime(),
      row.round_updated_at.getTime(),
      row.programme_updated_at.getTime(),
    );
    return {
      id: grantIdentifier(publisher.identifierPrefix, row.application_id),
      title: row.round_title,
      description: row.programme_summary,
      currency: row.currency,
      amountAwarded: amountAwarded({
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
      }),
      awardDate: localAt(timeZone, row.released_at).slice(0, 10),
      recipientOrganization: [recipient],
      fundingOrganization: [{ id: publisher.funderIdentifier, name: publisher.funderName }],
      grantProgramme: [{ title: row.programme_title }],
      dateModified: new Date(modified).toISOString(),
    };
  });
  const checked = threeSixtyGivingExportSchema.safeParse({
    file: { grants },
    summary: { grants: grants.length, unverifiedRecipients: [...unverified.values()] },
  });
  if (!checked.success) throw new ExportInvalid();
  return checked.data;
}
