// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';

import { confirmImport, getImport, listImportRows } from '../../contracts/index.ts';
import type { Page } from '../paged.ts';

export const loadJob = (importId: string) => call(getImport, { params: { importId } });

export async function loadRows(importId: string, cursor?: string) {
  const page = await call(listImportRows, {
    params: { importId },
    query: cursor === undefined ? {} : { cursor },
  });
  return { items: page.rows, nextCursor: page.nextCursor } satisfies Page<
    (typeof page.rows)[number]
  >;
}

export const confirm = (importId: string, duplicates: 'skip' | 'create', idempotencyKey: string) =>
  call(confirmImport, { params: { importId }, body: { duplicates } }, { idempotencyKey });
