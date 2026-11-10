// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for audit-writer.yaml, checked by `semgrep --test infra/semgrep`.

// ruleid: tps-audit-insert-only-in-writer
import { insertAuditEvent } from '@pixel-scientists/db';
// ruleid: tps-audit-insert-only-in-writer
import { insertAuditEvent as write } from '../../../packages/db/src/audit.ts';
// ruleid: tps-audit-insert-only-in-writer
export { insertAuditEvent } from '@pixel-scientists/db';
// ruleid: tps-audit-insert-only-in-writer
const { insertAuditEvent: later } = await import('@pixel-scientists/db');
// ruleid: tps-audit-insert-only-in-writer
await db.insertAuditEvent(trx, row);
// ok: tps-audit-insert-only-in-writer
import { recordAudit, recordRead } from '../audit/writer.ts';
// ok: tps-audit-insert-only-in-writer
await recordAudit(trx, actor, event);
// ok: tps-audit-insert-only-in-writer
await ctx.audit.record(event);
// ok: tps-audit-insert-only-in-writer
const insertAuditEvents = await listAuditEvents(trx);
// ruleid: tps-audit-insert-only-in-writer
await trx.insertInto('app.audit_event').values({ tenantId, action, changes }).execute();
// ruleid: tps-audit-insert-only-in-writer
await trx.withSchema('app').insertInto("audit_event").values(row).execute();
// ruleid: tps-audit-insert-only-in-writer
await sql`INSERT INTO app.audit_event (tenant_id, action, changes) VALUES (${tenantId}, ${action}, ${changes})`.execute(trx);
// ruleid: tps-audit-insert-only-in-writer
await client.query('insert into "app"."audit_event" (tenant_id, action) values ($1, $2)', [tenantId, action]);
// ok: tps-audit-insert-only-in-writer
await trx.selectFrom('app.audit_event').selectAll().where('entityId', '=', id).execute();
// ok: tps-audit-insert-only-in-writer
await client.query('SELECT count(*) FROM app.audit_event WHERE entity_id = $1', [id]);
// ok: tps-audit-insert-only-in-writer
await trx.insertInto('app.audit_event_pending').values(row).execute();
