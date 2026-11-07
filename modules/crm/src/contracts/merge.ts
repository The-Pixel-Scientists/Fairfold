// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Merging two organisations or two people (ADR 0025), under
// `crm.parties.merge` with step-up. Party's executor does the merge; crm
// asks for it and keeps the record.
//
// - Preview runs the executor and rolls it back: it answers the two records
//   side by side, party's conflict codes, the rows each module would
//   re-point, the loser's contact links and a token. It changes nothing and
//   writes `crm.merge.previewed`.
// - Confirm sends only the ids, the links to carry over and that token. The
//   server builds the preview again and refuses a token that does not
//   match it, was made for another member or tenant, or is more than five
//   minutes old (checkPreviewToken), so a blind, borrowed or stale confirm
//   is impossible. It answers the merge record's id and writes
//   `crm.merge.confirmed`.
// - A merge record is append-only: no route changes or removes one. A
//   reversal is its own step-up route that writes a new `unmerge` record
//   and `crm.merge.reversed`.
//
// The deciding member comes from the session, never a request.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  mergeConflictSchema,
  mergeCountsSchema,
  mergeInputSchema,
  partyKindSchema,
  valueHistoryFieldSchema,
  type MergeConflict,
  type MergeCounts,
  type PartyKind,
  type ValueHistoryField,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages, says } from './messages.ts';
import { personal, timestampSchema, unique } from './schemas.ts';

/** The most contact links one merge carries over. */
export const MAX_CARRIED_LINKS = 100;

/** How long a preview token is good for, in seconds: ADR 0010's step-up window. */
export const PREVIEW_TOKEN_LIFETIME = 300;

/** Its issue time in seconds since the epoch, a dot, then an HMAC-SHA-256 in base64url. */
const PREVIEW_TOKEN = /^(\d{10})\.[A-Za-z0-9_-]{43}$/;

export const previewTokenSchema = z
  .string()
  .refine((value) => PREVIEW_TOKEN.test(value), says(crmMessages.previewToken));

/**
 * What happens to the loser's current contact links: staff choose each one
 * to carry over (an organisation, or a person when either has an account),
 * they move by themselves (two people without accounts), or none moves (the
 * survivor's account is a member of staff).
 */
export const linkRules = ['choose', 'automatic', 'none'] as const;

export type LinkRule = (typeof linkRules)[number];

/** One field, side by side. */
export const mergeFieldSchema = z.strictObject({
  fieldId: valueHistoryFieldSchema,
  loser: z.string().nullable(),
  survivor: z.string().nullable(),
});

/** A current `contact_for` link of the loser's, by ids; the screen reads the names through party. */
export const mergeLinkSchema = z.strictObject({
  relationshipId: idSchema,
  personId: idSchema,
  organisationId: idSchema,
});

export const mergePreviewSchema = z.strictObject({
  loserId: idSchema,
  survivorId: idSchema,
  kind: partyKindSchema,
  fields: personal(z.array(mergeFieldSchema)),
  /** Empty when the merge can go ahead. */
  conflicts: z.array(mergeConflictSchema),
  counts: mergeCountsSchema,
  linkRule: z.enum(linkRules),
  links: z.array(mergeLinkSchema),
  token: previewTokenSchema,
});

export type MergePreview = z.infer<typeof mergePreviewSchema>;

export const mergeConfirmInputSchema = z
  .strictObject({
    ...mergeInputSchema.shape,
    /** The links staff chose to carry over, only when the link rule is `choose`. */
    carryOver: z
      .array(idSchema)
      .max(MAX_CARRIED_LINKS)
      .refine(...unique((id: string) => id))
      .default([]),
    token: previewTokenSchema,
  })
  .refine(({ loserId, survivorId }) => loserId !== survivorId, {
    ...says(crmMessages.samePartyTwice),
    path: ['survivorId'],
  });

export type MergeConfirmInput = z.input<typeof mergeConfirmInputSchema>;

export const mergeRecordKinds = ['merge', 'unmerge'] as const;

export const mergeRecordSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(mergeRecordKinds),
  partyKind: partyKindSchema,
  loserId: idSchema,
  survivorId: idSchema,
  /** For an unmerge, the merge it reverses. */
  reverses: idSchema.nullable(),
  decidedAt: timestampSchema,
  /** The deciding membership. */
  decidedBy: idSchema,
  counts: mergeCountsSchema,
});

export type MergeRecord = z.infer<typeof mergeRecordSchema>;

/** What a preview token covers. */
export interface PreviewBasis {
  readonly loserId: string;
  readonly survivorId: string;
  readonly kind: PartyKind;
  readonly fields: readonly {
    fieldId: ValueHistoryField;
    loser: string | null;
    survivor: string | null;
  }[];
  readonly conflicts: readonly MergeConflict[];
  readonly counts: MergeCounts;
  readonly linkRule: LinkRule;
  readonly links: readonly { relationshipId: string }[];
}

/** By code point, so the order is the same in every locale. */
const byFirst = ([a]: readonly unknown[], [b]: readonly unknown[]) =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

/** One text for a preview, the same whatever order its lists come in. */
export function previewBasisText(basis: PreviewBasis): string {
  const fields = basis.fields
    .map((field) => [field.fieldId, field.loser, field.survivor])
    .sort(byFirst);
  const counts = Object.entries(basis.counts)
    .map(([module, tables]) => [module, Object.entries(tables).sort(byFirst)] as const)
    .sort(byFirst);
  return JSON.stringify([
    basis.loserId,
    basis.survivorId,
    basis.kind,
    fields,
    [...basis.conflicts].sort(),
    counts,
    basis.linkRule,
    basis.links.map((link) => link.relationshipId).sort(),
  ]);
}

/** Whether the token sent is the one expected, in time that does not depend on where they differ. */
export function previewTokenMatches(expected: string, sent: string): boolean {
  if (expected.length === 0 || expected.length !== sent.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ sent.charCodeAt(index);
  }
  return difference === 0;
}

/** Who previewed, from the session; never from a request. */
export interface PreviewTokenOwner {
  readonly tenantId: string;
  readonly membershipId: string;
}

/**
 * The server's HMAC-SHA-256, with a secret of its own, of a text in
 * base64url without padding: only the server can make a token, and a token
 * repeats no value.
 */
export type PreviewTokenSigner = (text: string) => string;

/** The token for a preview made at `issuedAt` (seconds since the epoch) by `owner`. */
export function makePreviewToken(
  issuedAt: number,
  owner: PreviewTokenOwner,
  basis: PreviewBasis,
  sign: PreviewTokenSigner,
): string {
  const text = JSON.stringify([
    issuedAt,
    owner.tenantId,
    owner.membershipId,
    previewBasisText(basis),
  ]);
  return `${issuedAt}.${sign(text)}`;
}

/**
 * Whether a confirm's token is good: made no more than
 * PREVIEW_TOKEN_LIFETIME seconds before `now` and not after it, and the
 * same as the token made again from its issue time for the confirming
 * member and the preview the server builds again.
 */
export function checkPreviewToken(
  sent: string,
  now: number,
  owner: PreviewTokenOwner,
  basis: PreviewBasis,
  sign: PreviewTokenSigner,
): boolean {
  const issuedAt = Number(PREVIEW_TOKEN.exec(sent)?.[1]);
  if (!Number.isInteger(issuedAt) || issuedAt > now || now - issuedAt > PREVIEW_TOKEN_LIFETIME) {
    return false;
  }
  return previewTokenMatches(makePreviewToken(issuedAt, owner, basis, sign), sent);
}

const merge = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.parties.merge',
  scope: 'tenant',
  stepUp: true,
} as const;

export const previewMerge = defineRoute({
  ...merge,
  method: 'POST',
  path: '/console/crm/merges/preview',
  summary: 'Preview merging two records: fields, conflicts, links and rows to move',
  body: mergeInputSchema,
  responses: { 200: mergePreviewSchema },
});

export const confirmMerge = defineRoute({
  ...merge,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/merges',
  summary: 'Merge two records as previewed, with the preview token',
  body: mergeConfirmInputSchema,
  responses: { 201: mergeRecordSchema },
});

export const reverseMerge = defineRoute({
  ...merge,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/merges/:mergeRecordId/reversal',
  summary: 'Reverse the latest merge of two records, moving back the rows it moved',
  params: z.strictObject({ mergeRecordId: idSchema }),
  responses: { 201: mergeRecordSchema },
});

const read = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.records.read',
  scope: 'tenant',
} as const;

export const getMergeRecord = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/crm/merges/:mergeRecordId',
  summary: 'Read a merge or unmerge record',
  params: z.strictObject({ mergeRecordId: idSchema }),
  responses: { 200: mergeRecordSchema },
});

export const listPartyMerges = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/crm/parties/:partyId/merges',
  summary: 'List the merge and unmerge records of an organisation or person, newest first',
  params: z.strictObject({ partyId: idSchema }),
  responses: { 200: z.strictObject({ records: z.array(mergeRecordSchema) }) },
});

export const mergeRoutes = {
  previewMerge,
  confirmMerge,
  reverseMerge,
  getMergeRecord,
  listPartyMerges,
} as const;
