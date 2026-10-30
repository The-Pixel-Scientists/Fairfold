// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the audit log reads. Defined once, here, so a hook reads again only
// when a page asks it to.

import { getSettings } from '@pixel-scientists/domain/platform/settings';
import { listAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import { getTeam } from '@pixel-scientists/domain/platform/team';

import { callApi } from '../../api.ts';
import type { AuditFilters } from './query.ts';

export const loadEvents = (filters: AuditFilters, cursor?: string) =>
  callApi(listAuditEvents, { query: cursor === undefined ? filters : { ...filters, cursor } });

/** The funder's time zone, which the API's days run in, or null when it cannot be read: times then show in the browser's zone. */
export const loadTimeZone = (): Promise<string | null> =>
  callApi(getSettings, {}).then(
    (settings) => settings.timeZone,
    () => null,
  );

/** The team, for choosing a person. Anyone who may read the log but not the team gets none. */
export const loadMembers = () =>
  callApi(getTeam, {}).then(
    ({ members }) => members,
    () => null,
  );
