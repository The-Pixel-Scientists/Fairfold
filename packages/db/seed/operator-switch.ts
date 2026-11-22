// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed's copy of the operator switching tools on when it makes a tenant
// (apps/api/src/operator/switch-on.ts, ADR 0024): a row with the operator as
// author, its first configuration version (rule 10) and a switched_on event
// (rule 4). The audit writer in apps/api imports the modules' servers, so
// packages/db cannot call it; this is the seed's one audit insert, through
// the database call in src/audit.ts, which drops values of fields classified
// above internal. The action is a fixed platform code with no subject
// (ADR 0027), so the writer's checks hold by construction.

import { randomUUID } from 'node:crypto';

import {
  auditEntityType,
  type PlatformAuditAction,
  type SwitchableModuleId,
} from '@pixel-scientists/domain/platform';
import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import type { Transaction } from 'kysely';
import type pg from 'pg';

import { insertAuditEvent } from '../src/audit.ts';
import { kyselyOn } from '../src/database.ts';
import type { Insert } from './scenario.ts';

const action = 'platform.module.switched_on' satisfies PlatformAuditAction;

/** Switch on each of `tools` in the tenant set, inside the caller's transaction on `client`. */
export async function switchOnAsOperator(
  client: pg.ClientBase,
  insert: Insert,
  tenantId: string,
  tools: readonly SwitchableModuleId[],
): Promise<void> {
  const trx = kyselyOn(client) as unknown as Transaction<unknown>;
  const requestId = randomUUID();
  const changes: unknown = configDiffSchemas['platform.module'].parse([
    { field: 'enabled', from: false, to: true },
  ]);
  for (const module of tools) {
    const id = await insert('app.tenant_module', {
      tenant_id: tenantId,
      module,
      enabled: true,
      updated_by_kind: 'operator',
    });
    await insert('app.config_version', {
      tenant_id: tenantId,
      entity_type: 'platform.module',
      entity_id: id,
      version: 1,
      author_kind: 'operator',
      diff: JSON.stringify({ changes }),
    });
    await insertAuditEvent(trx, {
      requestId,
      actorKind: 'operator',
      actorId: null,
      action,
      entityType: auditEntityType(action),
      entityId: id,
      changes: {
        'app.tenant_module.module': { after: module },
        'app.tenant_module.enabled': { before: false, after: true },
      },
    });
  }
}
