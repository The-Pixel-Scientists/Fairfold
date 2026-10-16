// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Consent, Profile } from '@pixel-scientists/party/contracts';

/**
 * The latest choice about being emailed about future funding, if there is one.
 * It is the only purpose in MVP1 (a test fails when another is added), so it
 * is the profile's consent for the email channel.
 */
export function futureFundingChoice(profile: Profile): Consent | undefined {
  return profile.consents.find(({ channel }) => channel === 'email');
}
