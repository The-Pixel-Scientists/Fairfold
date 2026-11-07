// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing consent (ADR 0033). Signed in, a person reads and changes their
// own preferences; the person comes from the session. Not signed in, only
// the unsubscribe link in a marketing message: a public route with no
// session that sets no tenant, whose only input is an opaque token the
// server verifies before it touches the database.

import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { consentChangeSchema } from './inputs.ts';
import {
  consentChannelSchema,
  consentPurposeSchema,
  consentStateSchema,
  portalConsentChannels,
} from './lists.ts';

/** Every purpose and portal channel, with its current state: null when the person has not chosen. */
export const preferencesSchema = z.strictObject({
  preferences: z.array(
    z.strictObject({
      purpose: consentPurposeSchema,
      channel: z.enum(portalConsentChannels),
      state: consentStateSchema.nullable(),
      recordedAt: z.iso.datetime().nullable(),
    }),
  ),
});

export type Preferences = z.infer<typeof preferencesSchema>;

const ownPerson = {
  audience: 'portal',
  module: 'party',
  permission: 'party.profile.manage',
  scope: 'own_person',
} as const;

export const getPreferences = defineRoute({
  ...ownPerson,
  method: 'GET',
  path: '/portal/profile/preferences',
  summary: 'Read how you agree to be contacted, for each purpose and channel',
  responses: { 200: preferencesSchema },
});

/** Records one consent row when the choice differs from the current one; repeating it records nothing. */
export const changePreference = defineRoute({
  ...ownPerson,
  method: 'PUT',
  path: '/portal/profile/preferences',
  summary: 'Change whether you agree to be contacted, for one purpose and channel',
  body: consentChangeSchema,
  responses: { 200: preferencesSchema },
});

/**
 * The token from a message's `List-Unsubscribe` link: base64url, under a
 * length cap. It holds no address or name and is useless without the
 * server's key. Every bad token gets the same problem, which never repeats it.
 */
export const unsubscribeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,512}$/);

const unsubscribe = {
  audience: 'public',
  module: 'party',
  permission: null,
  scope: null,
  path: '/public/unsubscribe',
  query: z.strictObject({ token: unsubscribeTokenSchema }),
} as const;

/** What the token refers to, for the page: never an address or name. */
export const unsubscribeTargetSchema = z.strictObject({
  purpose: consentPurposeSchema,
  channel: consentChannelSchema,
});

export const unsubscribeOutcomes = ['unsubscribed', 'already_unsubscribed'] as const;

export const unsubscribeResultSchema = z.strictObject({ outcome: z.enum(unsubscribeOutcomes) });

/** Changes nothing, so a mail scanner that follows the link does no harm. */
export const getUnsubscribe = defineRoute({
  ...unsubscribe,
  method: 'GET',
  summary: 'Read what an unsubscribe link would stop',
  responses: { 200: unsubscribeTargetSchema },
});

/**
 * Records one withdrawal and suppression for the token's person, purpose and
 * channel. Answers without a redirect. Takes no body for now: the platform
 * refuses a form body and a request from another origin, so a mail client's
 * RFC 8058 `List-Unsubscribe=One-Click` POST waits on a public route marker
 * in the domain route contract that allows exactly that body without an
 * origin.
 */
export const confirmUnsubscribe = defineRoute({
  ...unsubscribe,
  method: 'POST',
  summary: 'Stop messages for one purpose and channel',
  responses: { 200: unsubscribeResultSchema },
});

/** Registered by S12-71. */
export const partyPreferenceRoutes = { getPreferences, changePreference } as const;

/** Both sit under the public rate limits (S11-36), checked before the token is verified. */
export const partyPublicRoutes = { getUnsubscribe, confirmUnsubscribe } as const;
