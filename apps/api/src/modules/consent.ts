// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The consent composition (ADR 0033): the portal's contact preferences, which
// party owns, and the public unsubscribe link. The preference routes need only
// the session. The unsubscribe routes need the unsubscribe secret, so a server
// without marketing email set up has no unsubscribe route, and no link to it.
// The one-click POST's form body is read by the transport app.ts registers
// beside these routes.

import { partyPreferenceRoutes } from '@pixel-scientists/party/contracts';
import { preferenceHandlers } from '@pixel-scientists/party/server';

import { unsubscribeKeys } from '../email/unsubscribe-token.ts';
import { unsubscribeRoutes, unsubscribeStoreOn } from '../public/unsubscribe/index.ts';
import { route, type Route } from '../routes/register.ts';
import type { ModuleFactory } from './types.ts';

export const consentComposition: ModuleFactory = ({ database, settings }) => {
  const preferences = preferenceHandlers();
  const routes: Route[] = [
    route(partyPreferenceRoutes.getPreferences, preferences.getPreferences),
    route(partyPreferenceRoutes.changePreference, preferences.changePreference),
  ];

  if (settings.marketing !== undefined) {
    const { current, versions } = settings.marketing.unsubscribe;
    routes.push(
      ...unsubscribeRoutes({
        keys: unsubscribeKeys(
          new Map([...versions].map(([version, secret]) => [version, secret.reveal()])),
          current,
        ),
        store: unsubscribeStoreOn(database.pool),
      }),
    );
  }

  return { routes };
};
