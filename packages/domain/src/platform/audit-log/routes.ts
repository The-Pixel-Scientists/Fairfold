// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log route for tenant admins (architecture rule 4).

import { defineRoute } from '../../api/route.ts';
import { auditEventPageSchema, auditEventQuerySchema } from './schemas.ts';

export const listAuditEvents = defineRoute({
  audience: 'console',
  module: 'platform',
  permission: 'platform.audit.read',
  scope: 'tenant',
  method: 'GET',
  path: '/console/audit-events',
  summary: "Read the tenant's audit log, newest first, a page at a time",
  query: auditEventQuerySchema,
  responses: { 200: auditEventPageSchema },
});
