// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lists: named sets of organisations and people that staff keep by hand.
// Members are party ids only. Archiving keeps a list and its members. No
// list route sends anything; a sender reads its people through
// `ListRecipients`, whose type holds only people party's may-contact check
// allowed (ADR 0033).

import { idSchema, type Id } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  partyKindSchema,
  type ConsentChannel,
  type MayContact,
  type MessageKind,
  type SkipCode,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages } from './messages.ts';
import {
  cursorSchema,
  line,
  pageQuerySchema,
  paragraphs,
  timestampSchema,
  unique,
} from './schemas.ts';

/** The most party ids one request adds or removes. */
export const MAX_MEMBERS_PER_CHANGE = 500;

const nameSchema = line(200, crmMessages.listName);

export const listInputSchema = z.strictObject({
  name: nameSchema,
  description: paragraphs(2000).optional(),
});

export type ListInput = z.input<typeof listInputSchema>;

/** A rename, a new description, or both. */
export const listUpdateSchema = listInputSchema.partial();

export type ListUpdate = z.input<typeof listUpdateSchema>;

export const listSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  members: z.int().nonnegative(),
  archivedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});

export type List = z.infer<typeof listSchema>;

/** By name, archived lists last. `nextCursor` is null on the last page. */
export const listPageSchema = z.strictObject({
  lists: z.array(listSchema),
  nextCursor: cursorSchema.nullable(),
});

export const memberChangeSchema = z.strictObject({
  partyIds: z
    .array(idSchema)
    .min(1)
    .max(MAX_MEMBERS_PER_CHANGE)
    .refine(...unique((id: string) => id)),
});

export type MemberChange = z.input<typeof memberChangeSchema>;

/** Ids already in or out of the list count as unchanged, so a repeat changes nothing. */
export const memberChangeResultSchema = z.strictObject({
  changed: z.int().nonnegative(),
  unchanged: z.int().nonnegative(),
});

/** Party ids and kinds only; the screen reads names through party. */
export const memberPageSchema = z.strictObject({
  members: z.array(
    z.strictObject({ partyId: idSchema, kind: partyKindSchema, addedAt: timestampSchema }),
  ),
  nextCursor: cursorSchema.nullable(),
});

/** A person a sender may contact now: party's may-contact check allowed them for this message. */
export interface CheckedRecipient {
  readonly personId: Id;
  readonly check: Extract<MayContact, { allowed: true }>;
}

/** A person left out, with party's skip code. */
export interface SkippedRecipient {
  readonly personId: Id;
  readonly code: SkipCode;
}

/**
 * The people on a list or in a segment, for a sender (S12-63). The crm
 * server checks each person with party's `mayContact()` for the channel
 * and message, in the sender's transaction; an organisation member gives
 * its current contacts. There is no other way to read recipients.
 */
export interface ListRecipients<Ctx> {
  recipients(
    ctx: Ctx,
    source: { readonly listId: Id } | { readonly segmentId: Id },
    send: { readonly channel: ConsentChannel; readonly message: MessageKind },
  ): Promise<{
    readonly allowed: readonly CheckedRecipient[];
    readonly skipped: readonly SkippedRecipient[];
  }>;
}

const manage = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.lists.manage',
  scope: 'tenant',
} as const;

const read = { ...manage, permission: 'crm.records.read' } as const;

const list = { params: z.strictObject({ listId: idSchema }) } as const;

export const listLists = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/crm/lists',
  summary: 'List lists by name, archived lists last',
  query: pageQuerySchema,
  responses: { 200: listPageSchema },
});

export const createList = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/lists',
  summary: 'Create a list',
  body: listInputSchema,
  responses: { 201: listSchema },
});

export const updateList = defineRoute({
  ...manage,
  ...list,
  method: 'PATCH',
  path: '/console/crm/lists/:listId',
  summary: 'Rename a list or change its description',
  body: listUpdateSchema,
  responses: { 200: listSchema },
});

export const archiveList = defineRoute({
  ...manage,
  ...list,
  method: 'POST',
  path: '/console/crm/lists/:listId/archive',
  summary: 'Archive a list, keeping its members',
  responses: { 200: listSchema },
});

export const listMembers = defineRoute({
  ...read,
  ...list,
  method: 'GET',
  path: '/console/crm/lists/:listId/members',
  summary: "Read a list's members, newest first",
  query: pageQuerySchema,
  responses: { 200: memberPageSchema },
});

export const addMembers = defineRoute({
  ...manage,
  ...list,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/lists/:listId/members',
  summary: 'Add organisations and people to a list',
  body: memberChangeSchema,
  responses: { 200: memberChangeResultSchema },
});

export const removeMembers = defineRoute({
  ...manage,
  ...list,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/lists/:listId/members/removal',
  summary: 'Remove organisations and people from a list',
  body: memberChangeSchema,
  responses: { 200: memberChangeResultSchema },
});

export const listRoutes = {
  listLists,
  createList,
  updateList,
  archiveList,
  listMembers,
  addMembers,
  removeMembers,
} as const;
