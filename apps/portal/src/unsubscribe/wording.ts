// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ConsentChannel, ConsentPurpose } from '@pixel-scientists/party/contracts';

/** A new purpose or channel fails the type check until it has words. */
const purposeWords = {
  future_funding: 'future funding',
} as const satisfies Record<ConsentPurpose, string>;

const channelWords = {
  email: 'emails',
  sms: 'text messages',
  phone: 'phone calls',
  post: 'post',
} as const satisfies Record<ConsentChannel, string>;

/** "emails about future funding". */
export function whatStops(purpose: ConsentPurpose, channel: ConsentChannel): string {
  return `${channelWords[channel]} about ${purposeWords[purpose]}`;
}
