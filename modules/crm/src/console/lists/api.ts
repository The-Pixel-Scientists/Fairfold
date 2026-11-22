// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the list and segment pages send. Member ids and filters travel in the
// body; no id of a member, tenant or actor is ever made by the client.

import { call } from '@pixel-scientists/domain/api';

import {
  addMembers,
  archiveList,
  createList,
  createSegment,
  getSegment,
  listLists,
  listMembers,
  listSegments,
  removeMembers,
  segmentMembers,
  updateList,
} from '../../contracts/index.ts';
import type { List, SegmentInput } from '../../contracts/index.ts';
import type { Page } from '../paged.ts';

const cursorQuery = (cursor?: string) => (cursor === undefined ? {} : { cursor });

export async function loadLists(_key: null, cursor?: string): Promise<Page<List>> {
  const page = await call(listLists, { query: cursorQuery(cursor) });
  return { items: page.lists, nextCursor: page.nextCursor };
}

export const makeList = (name: string, description: string, idempotencyKey: string) =>
  call(
    createList,
    { body: { name, ...(description === '' ? {} : { description }) } },
    { idempotencyKey },
  );

export const renameList = (listId: string, name: string) =>
  call(updateList, { params: { listId }, body: { name } });

export const archive = (listId: string) => call(archiveList, { params: { listId } });

export async function loadMembers(listId: string, cursor?: string) {
  const page = await call(listMembers, { params: { listId }, query: cursorQuery(cursor) });
  return { items: page.members, nextCursor: page.nextCursor };
}

export const add = (listId: string, partyIds: string[], idempotencyKey: string) =>
  call(addMembers, { params: { listId }, body: { partyIds } }, { idempotencyKey });

export const remove = (listId: string, partyIds: string[], idempotencyKey: string) =>
  call(removeMembers, { params: { listId }, body: { partyIds } }, { idempotencyKey });

export async function loadSegments(_key: null, cursor?: string) {
  const page = await call(listSegments, { query: cursorQuery(cursor) });
  return { items: page.segments, nextCursor: page.nextCursor };
}

export const saveSegment = (body: SegmentInput, idempotencyKey: string) =>
  call(createSegment, { body }, { idempotencyKey });

export const loadSegment = (segmentId: string) => call(getSegment, { params: { segmentId } });

export async function loadSegmentMembers(segmentId: string, cursor?: string) {
  const page = await call(segmentMembers, { params: { segmentId }, query: cursorQuery(cursor) });
  return { items: page.members, nextCursor: page.nextCursor };
}
