// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';

import { dismissDuplicate, listDuplicates } from '../../contracts/index.ts';
import type { DismissReason, DuplicatePair } from '../../contracts/index.ts';
import type { Page } from '../paged.ts';

export interface DuplicateFilters {
  kind: 'any' | 'organisation' | 'person';
  signal: 'any' | DuplicatePair['signals'][number];
}

export const noDuplicateFilters: DuplicateFilters = { kind: 'any', signal: 'any' };

/** The filters travel in the body, never in an address. */
export async function loadDuplicates(
  filters: DuplicateFilters,
  cursor?: string,
): Promise<Page<DuplicatePair>> {
  const page = await call(listDuplicates, {
    body: {
      ...(filters.kind === 'any' ? {} : { kind: filters.kind }),
      ...(filters.signal === 'any' ? {} : { signals: [filters.signal] }),
      ...(cursor === undefined ? {} : { cursor }),
    },
  });
  return { items: page.pairs, nextCursor: page.nextCursor };
}

export const dismiss = (pair: DuplicatePair, reason: DismissReason, idempotencyKey: string) =>
  call(
    dismissDuplicate,
    { body: { partyId: pair.partyId, otherPartyId: pair.otherPartyId, reason } },
    { idempotencyKey },
  );
