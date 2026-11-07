// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tenant files job (ADR 0030, "Retention" and "Rescans"): the file sweep
// and then the withheld recheck of one tenant, in that tenant's transaction.
// The daily fan-out sends each tenant one job, keyed on the run's slot, and
// one handler does both steps in turn, so a tenant's sweep and recheck are
// never active at once and one tenant's job never stops another's. The
// payload holds a slot only, and a failure is recorded as a code only. Each
// run writes one audit event per step and tenant, never a name or key.

import { defineHandler, defineQueue, type JobHandler } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { recordAudit } from '../../audit/writer.ts';
import {
  recheckTenant,
  sweepTenant,
  type FilesJobDependencies,
} from '../../platform/files/index.ts';
import { jobActor } from '../job-actor.ts';

// Counts ride as numeric `after` values on the nearest classified app.file
// column (no count field id exists yet): sweep released_at = files released
// and deleted, scan_state = files refused and deleted, storage_key = orphan
// objects removed; recheck scan_state = restored, scanned_at = still withheld.

/** Migration 0029's tenant queue for file work. */
export const filesQueue = defineQueue(
  'platform.file_scan',
  'tenant',
  z.strictObject({ slot: idSchema }),
);

export const filesHandler = (deps: FilesJobDependencies): JobHandler<unknown> =>
  defineHandler<unknown, (typeof filesQueue)['data'], 'tenant'>(filesQueue, async (trx, job) => {
    const { id: tenant } = await trx
      .selectNoFrom((eb) => eb.fn<string>('app.current_tenant_id', []).as('id'))
      .executeTakeFirstOrThrow();
    const actor = jobActor(job);
    const swept = await sweepTenant(trx, deps, tenant);
    await recordAudit(trx, actor, {
      action: 'platform.file_sweep.completed',
      entityId: tenant,
      changes: {
        'app.file.released_at': { after: swept.released },
        'app.file.scan_state': { after: swept.refused },
        'app.file.storage_key': { after: swept.objects },
      },
    });
    const rechecked = await recheckTenant(trx, deps, tenant, actor);
    await recordAudit(trx, actor, {
      action: 'platform.file_recheck.completed',
      entityId: tenant,
      changes: {
        'app.file.scan_state': { after: rechecked.restored },
        'app.file.scanned_at': { after: rechecked.stillWithheld },
      },
    });
  });
