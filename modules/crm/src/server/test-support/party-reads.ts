// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The `PartyReads` the platform supplies, for crm's integration tests: party's own, so the
// tests exercise what ships.

import { partyReadsForCrm } from '@pixel-scientists/party/server';

import type { PartyReads } from '../parties.ts';

export const testPartyReads: PartyReads = partyReadsForCrm;
