// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the privacy screens read from the API besides their own routes.

import { call } from '@pixel-scientists/domain/api';
import { getSettings } from '@pixel-scientists/domain/platform/settings';
import { getTeam } from '@pixel-scientists/domain/platform/team';
import { getPerson } from '@pixel-scientists/party/contracts';

/** Where a funder's days run when its settings cannot be read. */
const DEFAULT_ZONE = 'Europe/London';

let zone: Promise<string> | undefined;

/** The funder's time zone, read once. Members who may not read settings see UK time. */
export function loadTimeZone(): Promise<string> {
  zone ??= call(getSettings, {}).then(
    (settings) => settings.timeZone,
    () => DEFAULT_ZONE,
  );
  return zone;
}

/** The team, to assign tasks. Members who may not read it get null and assign no one. */
export const loadMembers = () =>
  call(getTeam, {}).then(
    ({ members }) => members.filter(({ status }) => status === 'active'),
    () => null,
  );

/** A person's name as their record gives it, or null when it cannot be read or is empty. */
export const loadPersonName = (personId: string) =>
  call(getPerson, { params: { personId } }).then(
    ({ givenName, familyName }) => [givenName, familyName].filter(Boolean).join(' ') || null,
    () => null,
  );
