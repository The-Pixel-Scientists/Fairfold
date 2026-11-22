// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The interaction table as the timeline reads and writes it, including the
// columns crm's shared table types leave out.

import type { Tx } from '../context.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type Tables = {
  'crm.interaction': {
    tenant_id: string;
    id: Generated<string>;
    party_id: string;
    kind: string;
    occurred_at: Date;
    source_module: string;
    source_entity_type: string | null;
    source_entity_id: string | null;
    summary: string | null;
    recorded_by: string | null;
  };
};

export const interactionDb = (tx: Tx) => tx.$extendTables<Tables>();
