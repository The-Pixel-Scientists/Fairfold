// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The operator's tenant source (ADR 0019, the sixth): a tenant just made by
// app.create_tenant(), as app_worker. This is the one file that holds the
// id it returns. The id never leaves it: callers get a function that runs
// work in that tenant's transaction. Semgrep keeps createTenant() out of the
// rest of the code.

import { createTenant, withTenant, type Kysely, type Transaction } from '@pixel-scientists/db';

export interface NewTenant {
  readonly id: string;
  /** Run `work` in a transaction of the new tenant. */
  inTenant<T>(work: (trx: Transaction<unknown>) => Promise<T>): Promise<T>;
}

/** Make a tenant. The database refuses a bad, reserved or taken slug. */
export async function makeTenant(
  worker: Kysely<unknown>,
  tenant: { readonly slug: string; readonly name: string },
): Promise<NewTenant> {
  const id = await createTenant(worker, tenant);
  return { id, inTenant: (work) => withTenant(worker, id, work) };
}
