// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Searching organisations and people (ADR 0025). The term and the filters
// travel in the POST body only, and come back in no response, problem, log
// or audit value. Results are party ids with a label, never more: the
// detail routes read the record. A page holding any person writes
// `crm.party.found` with the result ids. The providers feed the same
// matches to the console's search across tools (S12-16).
//
// Module code may not yet import `@pixel-scientists/domain/platform/search`
// (eslint.config.js allows one subpath level), so the term schema keeps the
// platform's rules here and the providers are plain data; search.test.ts
// checks both against the platform's own until the import is allowed.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';
import { partyKinds, partyKindSchema } from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages } from './messages.ts';
import { choice, cursorSchema, personal, unique } from './schemas.ts';

/** A party's state, as party keeps it (ADR 0025). */
export const partyStatuses = ['active', 'archived', 'merged', 'erased'] as const;

export type PartyStatus = (typeof partyStatuses)[number];

/**
 * An organisation's best identifier: one verified by staff, only
 * unverified claims, or none. Always `none` for a person.
 */
export const verificationStates = ['verified', 'claimed', 'none'] as const;

export type VerificationState = (typeof verificationStates)[number];

/** The platform's search term (S11-42): NFKC, spaces collapsed, 2 to 100 characters, nothing hidden. */
export const termSchema = z
  .string()
  .overwrite((term) => term.normalize('NFKC').replace(/\s+/g, ' ').trim())
  .refine((term) => !/[\p{Cc}\p{Cs}]/u.test(term), { error: messages.notValid })
  .min(2)
  .max(100);

/** The most results a page holds. */
export const SEARCH_PAGE_LIMIT = 50;

export const partySearchRequestSchema = z.strictObject({
  term: termSchema,
  /** Both kinds when left out. */
  kinds: z
    .array(choice(partyKinds, crmMessages.partyKind))
    .min(1)
    .max(partyKinds.length)
    .refine(...unique((kind: string) => kind))
    .optional(),
  /** Active parties when left out; merged and erased ones answer only their status. */
  statuses: z
    .array(choice(partyStatuses, crmMessages.partyStatus))
    .min(1)
    .max(partyStatuses.length)
    .refine(...unique((status: string) => status))
    .optional(),
  verification: choice(verificationStates, crmMessages.verification).optional(),
  /** Only members of this list. */
  listId: idSchema.optional(),
  limit: z.int().min(1).max(SEARCH_PAGE_LIMIT).default(25),
  cursor: cursorSchema.optional(),
});

export type PartySearchRequest = z.input<typeof partySearchRequestSchema>;

export const partySearchResultSchema = z.strictObject({
  id: idSchema,
  kind: partyKindSchema,
  /** An organisation's name or a person's full name. */
  label: personal(z.string().min(1).max(200)),
  status: z.enum(partyStatuses),
  verification: z.enum(verificationStates),
});

/** Best match first. `nextCursor` is null on the last page. */
export const partySearchPageSchema = z.strictObject({
  results: z.array(partySearchResultSchema).max(SEARCH_PAGE_LIMIT),
  nextCursor: cursorSchema.nullable(),
});

export type PartySearchPage = z.infer<typeof partySearchPageSchema>;

/** A POST so the term stays out of URLs; it changes nothing, so it is not idempotent. */
export const searchParties = defineRoute({
  audience: 'console',
  module: 'crm',
  permission: 'crm.records.read',
  scope: 'tenant',
  method: 'POST',
  path: '/console/crm/search',
  summary: 'Search organisations and people, with the term and filters in the body',
  body: partySearchRequestSchema,
  responses: { 200: partySearchPageSchema },
});

/** A search provider (S11-42) for staff, checked by checkSearchProvider() in search.test.ts. */
const provider = {
  module: 'crm',
  permission: 'crm.records.read',
  scopes: ['tenant'],
  audiences: ['staff'],
} as const;

/** Organisations by name and identifier, both internal. */
export const organisationSearchProvider = {
  ...provider,
  kind: 'crm.organisation',
  fields: [
    { id: 'match_name', sensitivity: 'internal', audiences: ['staff'] },
    { id: 'identifier', sensitivity: 'internal', audiences: ['staff'] },
  ],
  label: 'internal',
} as const;

/** People by name and email address: personal, so every read is audited. */
export const personSearchProvider = {
  ...provider,
  kind: 'crm.person',
  fields: [
    { id: 'match_name', sensitivity: 'personal', audiences: ['staff'], identity: true },
    { id: 'email', sensitivity: 'personal', audiences: ['staff'], identity: true },
  ],
  label: 'personal',
  readAction: 'crm.party.found',
} as const;

export const searchProviders = [organisationSearchProvider, personSearchProvider] as const;
