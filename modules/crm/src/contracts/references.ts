// SPDX-License-Identifier: AGPL-3.0-or-later
//
// External references (ADR 0008, ADR 0017): the id an organisation or person
// has in another system, kept for a later sync through `connect`. A
// reference is a pointer only: no credentials, tokens or sync state, and it
// never links or changes the party. One system and id is held once per
// party; a second answers 409.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { crmMessages, says } from './messages.ts';
import { choice, timestampSchema } from './schemas.ts';

export const externalSystems = ['twenty', 'salesforce', 'other'] as const;

export type ExternalSystem = (typeof externalSystems)[number];

/** Letters, digits, dots, hyphens, underscores and colons, starting with a letter or digit. */
export const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export const EXTERNAL_URL_MAX = 500;

/** An https address with a host name and no user name or password, of at most EXTERNAL_URL_MAX characters. */
export function isExternalUrl(value: string): boolean {
  if (value.length > EXTERNAL_URL_MAX || !value.startsWith('https://') || !URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.hostname.includes('.')
  );
}

export const externalReferenceInputSchema = z.strictObject({
  system: choice(externalSystems, crmMessages.externalSystem),
  externalId: z
    .string()
    .trim()
    .refine((value) => EXTERNAL_ID.test(value), says(crmMessages.externalId)),
  url: z.string().trim().refine(isExternalUrl, says(crmMessages.externalUrl)).optional(),
});

export type ExternalReferenceInput = z.input<typeof externalReferenceInputSchema>;

export const externalReferenceSchema = z.strictObject({
  id: idSchema,
  system: z.enum(externalSystems),
  externalId: z.string(),
  url: z.string().nullable(),
  addedAt: timestampSchema,
});

export type ExternalReference = z.infer<typeof externalReferenceSchema>;

const references = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.records.manage',
  scope: 'tenant',
} as const;

export const listExternalReferences = defineRoute({
  ...references,
  permission: 'crm.records.read',
  method: 'GET',
  path: '/console/crm/parties/:partyId/external-references',
  summary: "List an organisation's or person's external references",
  params: z.strictObject({ partyId: idSchema }),
  responses: { 200: z.strictObject({ references: z.array(externalReferenceSchema) }) },
});

export const addExternalReference = defineRoute({
  ...references,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/parties/:partyId/external-references',
  summary: 'Add the id an organisation or person has in another system',
  params: z.strictObject({ partyId: idSchema }),
  body: externalReferenceInputSchema,
  responses: { 201: externalReferenceSchema },
});

export const removeExternalReference = defineRoute({
  ...references,
  method: 'DELETE',
  path: '/console/crm/parties/:partyId/external-references/:referenceId',
  summary: 'Remove an external reference',
  params: z.strictObject({ partyId: idSchema, referenceId: idSchema }),
  responses: { 204: null },
});

export const referenceRoutes = {
  listExternalReferences,
  addExternalReference,
  removeExternalReference,
} as const;
