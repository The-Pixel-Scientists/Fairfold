// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form handlers read from the platform, on top of the programme
// set-up's (ADR 0016). The platform passes in one function that writes the
// next configuration version of any entity, so the same one serves both.

import type { formConfigEntityType, FormVersionDiff } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

export interface FormDependencies extends Pick<GrantsDependencies, 'notFound' | 'refuse'> {
  /** Writes the round's next form configuration version (rule 10) in the request's transaction. */
  readonly recordConfig: (
    tx: Tx,
    authorId: string,
    entityType: typeof formConfigEntityType,
    entityId: string,
    changes: FormVersionDiff['changes'],
  ) => Promise<void>;
}

export interface VersionParams {
  readonly params: { readonly formVersionId: string };
}
