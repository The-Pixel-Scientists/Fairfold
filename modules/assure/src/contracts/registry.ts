// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Registry lookups (ADR 0031): the registers assure reads, the adapter each
// one has on the server, and the normalised result an adapter returns. A
// result holds only the fields below, parsed strictly: no raw response, no
// free-form blob, and nothing to render as HTML or follow as a link. An
// adapter reads its key with readSecret and calls out through the dispatcher
// (ADR 0010), so the interface takes no key, address or HTTP client.

import { moneySchema } from '@pixel-scientists/domain/platform';
import { identifierSchemes, type IdentifierScheme } from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { assureMessages } from './messages.ts';
import { choice, dateSchema, HIDDEN, timestampSchema } from './schemas.ts';

/** Each register, with the party identifier scheme it serves. */
export const registries = {
  charity_commission: 'GB-CHC',
  companies_house: 'GB-COH',
  oscr: 'GB-SC',
  ccni: 'GB-NIC',
} as const satisfies Record<string, IdentifierScheme>;

export type Registry = keyof typeof registries;

export const registryIds = Object.keys(registries) as [Registry, ...Registry[]];

export const registrySchema = z.enum(registryIds);

/** A register, as a request names it. */
export const registryInputSchema = choice(registryIds, assureMessages.registry);

/** Each register's own states, mapped to one list. */
export const registryStatuses = [
  'registered',
  'removed',
  'active',
  'dissolved',
  'in_liquidation',
  'other',
] as const;

export const officerRoles = [
  'trustee',
  'director',
  'secretary',
  'person_with_significant_control',
  'other',
] as const;

export const officerRoleSchema = z.enum(officerRoles);

/** The most officers a result keeps. */
export const MAX_OFFICERS = 200;

/** Text from a register: one trimmed line, never empty. */
function registryText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !HIDDEN.test(value));
}

const filedAmountSchema = moneySchema.extend({ amountMinor: z.int().min(0) });

/** What a found entry says, besides its register, identifier and officers. */
export const registryDetailsSchema = z.strictObject({
  status: z.enum(registryStatuses),
  registeredName: registryText(300),
  /** Structured as party.organisation's registered address. */
  registeredAddress: z
    .strictObject({
      line1: registryText(200),
      line2: registryText(200).nullable(),
      town: registryText(100),
      postcode: registryText(16),
      countryCode: z.string().regex(/^[A-Z]{2}$/),
    })
    .nullable(),
  registeredOn: dateSchema.nullable(),
  removedOn: dateSchema.nullable(),
  /** The latest filed accounts; income and expenditure in minor units where the register gives them. */
  accounts: z
    .strictObject({
      periodEnd: dateSchema,
      income: filedAmountSchema.nullable(),
      expenditure: filedAmountSchema.nullable(),
    })
    .nullable(),
  /** Companies only. */
  accountsOverdue: z.boolean().nullable(),
});

/**
 * A found entry. Officers are the current ones, by name and role only: no
 * date of birth, nationality, address or appointment date.
 */
export const registryResultSchema = z
  .strictObject({
    registry: registrySchema,
    /** As normaliseIdentifier() writes it for the register's scheme. */
    identifier: z.string().max(30),
    fetchedAt: timestampSchema,
    ...registryDetailsSchema.shape,
    officers: z
      .array(z.strictObject({ name: registryText(200), role: officerRoleSchema }))
      .max(MAX_OFFICERS),
  })
  .refine(
    (result) => identifierSchemes[registries[result.registry]].pattern.test(result.identifier),
    { path: ['identifier'] },
  );

export type RegistryResult = z.infer<typeof registryResultSchema>;

export type Classification = 'public' | 'internal' | 'personal';

/**
 * Each result field's class, for the schema's classification file and the
 * console's projection. An organisation's registered address may be a
 * home (ADR 0017), and officers' names are about people.
 */
export const registryResultClassification = {
  registry: 'internal',
  identifier: 'internal',
  fetchedAt: 'internal',
  status: 'internal',
  registeredName: 'internal',
  registeredAddress: 'personal',
  registeredOn: 'internal',
  removedOn: 'internal',
  accounts: 'internal',
  accountsOverdue: 'internal',
  officers: 'personal',
} as const satisfies Record<keyof RegistryResult, Classification>;

/** Why a lookup found nothing. Codes only: never a response value, key or address. */
export const lookupFailures = [
  'not_found',
  'not_set_up',
  'registry_unavailable',
  'rate_limited',
  'response_refused',
] as const;

export type LookupFailure = (typeof lookupFailures)[number];

export type LookupOutcome =
  | { readonly ok: true; readonly result: RegistryResult }
  | { readonly ok: false; readonly failure: LookupFailure };

/** One register's adapter, built on the server with its key and client. */
export interface RegistryAdapter {
  readonly registry: Registry;
  /** Looks up one identifier, normalised for the register's scheme. A register's answer never throws. */
  lookUp(identifier: string): Promise<LookupOutcome>;
}
