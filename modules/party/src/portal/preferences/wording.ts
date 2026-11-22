// SPDX-License-Identifier: AGPL-3.0-or-later

import { consentChannelLabels } from '@pixel-scientists/party/contracts';
import type { ConsentChannel, ConsentPurpose } from '@pixel-scientists/party/contracts';

/** What a person would receive, for each purpose. A new purpose fails the type check until it has words. */
const purposeWords = {
  future_funding: 'News about future funding rounds',
} as const satisfies Record<ConsentPurpose, string>;

/** "News about future funding rounds, by email". */
export function preferenceLabel(purpose: ConsentPurpose, channel: ConsentChannel): string {
  return `${purposeWords[purpose]}, by ${consentChannelLabels[channel].toLowerCase()}`;
}
