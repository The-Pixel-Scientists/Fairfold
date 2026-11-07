// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner and label routes (E7, ADR 0004), anywhere in the session's tenant.
// They sit beside the submission routes, so a draft's id answers 404, as if
// it did not exist, and so does another tenant's application.
//
// The rules the server (S12-39) holds:
// - members with `grants.applications.triage` set an application's owner
//   and its labels, one at a time or in bulk. A bulk change is all or none,
//   like a stage move: if any id is not found, or a label is archived or
//   unknown, nothing changes;
// - an owner is at most one active member, and the server re-reads at write
//   time, in the request's tenant, that they hold `grants.applications.read`
//   (rule 6). A refusal says triageMessages.ownerCannotView and names no one;
// - members with `grants.programmes.manage` create, rename, recolour and
//   archive the tenant's labels (schemas.ts). Every member who reads
//   applications lists them, to filter and choose by;
// - each application changed records one event of its own, even in bulk:
//   `grants.application.owner_changed` with the membership ids before and
//   after, or `grants.application.labels_changed` with the label ids added
//   and removed. A label change records `grants.label.created`, `.updated`
//   or `.archived` with the label id and the changed field paths. Changes
//   hold ids, codes and counts, never a label's name or a person's name.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  appliedLabelsSchema,
  bulkLabelChangeInputSchema,
  bulkOwnerInputSchema,
  bulkTriageResultSchema,
  labelChangeInputSchema,
  labelInputSchema,
  labelListSchema,
  labelSchema,
  ownerAnswerSchema,
  ownerInputSchema,
} from './schemas.ts';

const staff = { audience: 'console', module: 'grants', scope: 'tenant' } as const;
const triage = { ...staff, permission: 'grants.applications.triage' } as const;
const manage = { ...staff, permission: 'grants.programmes.manage' } as const;

const submission = z.strictObject({ submissionId: idSchema });
const label = z.strictObject({ labelId: idSchema });

export const setOwner = defineRoute({
  ...triage,
  method: 'PUT',
  path: '/console/submissions/:submissionId/owner',
  summary: "Set or clear a submission's owner",
  params: submission,
  body: ownerInputSchema,
  responses: { 200: ownerAnswerSchema },
});

export const setOwners = defineRoute({
  ...triage,
  method: 'POST',
  path: '/console/submission-owners',
  summary: 'Set or clear the owner of up to 200 submissions, all or none',
  body: bulkOwnerInputSchema,
  responses: { 200: bulkTriageResultSchema },
});

export const changeLabels = defineRoute({
  ...triage,
  method: 'PATCH',
  path: '/console/submissions/:submissionId/labels',
  summary: 'Add labels to a submission and remove others',
  params: submission,
  body: labelChangeInputSchema,
  responses: { 200: appliedLabelsSchema },
});

export const changeLabelsInBulk = defineRoute({
  ...triage,
  method: 'POST',
  path: '/console/submission-labels',
  summary: 'Add labels to up to 200 submissions and remove others, all or none',
  body: bulkLabelChangeInputSchema,
  responses: { 200: bulkTriageResultSchema },
});

export const listLabels = defineRoute({
  ...staff,
  permission: 'grants.applications.read',
  method: 'GET',
  path: '/console/labels',
  summary: "List the tenant's labels, archived ones included",
  responses: { 200: labelListSchema },
});

export const createLabel = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/labels',
  summary: 'Create a label',
  body: labelInputSchema,
  responses: { 201: labelSchema },
});

export const updateLabel = defineRoute({
  ...manage,
  method: 'PUT',
  path: '/console/labels/:labelId',
  summary: 'Rename a label or change its colour, as a new configuration version',
  params: label,
  body: labelInputSchema,
  responses: { 200: labelSchema },
});

export const archiveLabel = defineRoute({
  ...manage,
  method: 'POST',
  path: '/console/labels/:labelId/archive',
  summary: 'Archive a label, so it stays where it is but cannot be added again',
  params: label,
  responses: { 200: labelSchema },
});

export const triageRoutes = {
  setOwner,
  setOwners,
  changeLabels,
  changeLabelsInBulk,
  listLabels,
  createLabel,
  updateLabel,
  archiveLabel,
} as const;
