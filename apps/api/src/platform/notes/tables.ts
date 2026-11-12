// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the note and message service queries (migration 0052), as the
// API's role may reach them. Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type { MessageSide } from '@pixel-scientists/domain/notes';

import type { TenantTransaction } from '../../database.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type NoteTables = {
  'app.note': {
    tenant_id: string;
    id: Generated<string>;
    body: string;
    author_id: string;
    created_at: Generated<Date>;
  };
  'app.note_mention': { tenant_id: string; note_id: string; membership_id: string };
  'app.message_thread': {
    tenant_id: string;
    id: Generated<string>;
    applicant_read_at: Date | null;
    staff_read_at: Date | null;
  };
  'app.message': {
    tenant_id: string;
    id: Generated<string>;
    thread_id: string;
    side: MessageSide;
    body: string;
    author_membership_id: string | null;
    author_person_id: string | null;
    created_at: Generated<Date>;
  };
  'app.membership': { id: string; user_id: string };
};

export const notesDb = (tx: TenantTransaction) => tx.$extendTables<NoteTables>();
