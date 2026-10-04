// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log as a tenant admin reads it (architecture rule 4, ADR 0003).
// Events hold ids, codes and field ids, with values only for the public and
// internal fields the writer kept (D12). The only names added at read time
// are staff members', never an applicant's, so reading the log is not
// audited (D23).

import { z } from 'zod';

import { idSchema } from '../../id.ts';
import { auditActionPattern } from '../audit.ts';
import { moduleSchema } from '../modules.ts';

/** `<module>.<entity>`, such as `grants.decision`: an action without its event. */
const entityTypeSchema = z
  .string()
  .max(100)
  .regex(/^[a-z]+\.[a-z][a-z_]*$/);

const actionSchema = z.string().max(100).regex(auditActionPattern);

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const auditCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/**
 * Every filter is optional, and these are the only keys. Dates are whole
 * days in the tenant's time zone, `from` and `to` both included.
 */
export const auditEventQuerySchema = z.strictObject({
  module: moduleSchema.optional(),
  action: actionSchema.optional(),
  entityType: entityTypeSchema.optional(),
  entityId: idSchema.optional(),
  /** The membership that acted. */
  byMembershipId: idSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: auditCursorSchema.optional(),
});

export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>;

/** A column's field id, `<schema>.<table>.<column>`, or a form field's id. */
const changedFieldSchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*|f_[a-z0-9]{1,32})$/);

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** A kept value: a public or internal column's value, a plain value or a list of them. */
const keptValueSchema = z.union([scalar, z.array(scalar)]);

/** Either value is absent when the writer did not keep it; `{}` means only that it changed. */
const fieldChangeSchema = z.object({
  before: keptValueSchema.optional(),
  after: keptValueSchema.optional(),
});

/**
 * Who acted. `staff` is a membership that holds a console role and no portal
 * role, named from its person record (null when it has none; the console
 * then shows "Team member"). Every other membership is an `applicant` and is
 * never named, so a reader without access to applicants cannot learn from
 * the log who they are or what they did.
 */
const auditActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('staff'), membershipId: idSchema, name: z.string().nullable() }),
  z.strictObject({ kind: z.literal('applicant'), membershipId: idSchema }),
  z.strictObject({ kind: z.enum(['system', 'operator']) }),
]);

export const auditEventSchema = z.object({
  id: idSchema,
  occurredAt: z.iso.datetime(),
  action: actionSchema,
  entityType: entityTypeSchema,
  entityId: idSchema,
  actor: auditActorSchema,
  changes: z.record(changedFieldSchema, fieldChangeSchema),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

/** Newest first. `nextCursor` is null on the last page. */
export const auditEventPageSchema = z.object({
  events: z.array(auditEventSchema),
  nextCursor: auditCursorSchema.nullable(),
});

export type AuditEventPage = z.infer<typeof auditEventPageSchema>;
