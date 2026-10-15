// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Form version routes (ADR 0004). Staff with `grants.programmes.manage`
// build any round's form in their tenant: they start a draft, save it as
// often as they like, then publish it as a fixed version or discard it.
// Only a draft changes. Each change writes an audit event, and publishing
// writes a configuration version (config.ts).

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { formVersionListSchema, formVersionSchema } from './answers.ts';
import { formDraftInputSchema } from './inputs.ts';

const manage = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
} as const;

const round = { ...manage, params: z.strictObject({ roundId: idSchema }) } as const;
const version = { ...manage, params: z.strictObject({ formVersionId: idSchema }) } as const;

export const listFormVersions = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/form-versions',
  summary: "List a round's form versions, the newest first",
  responses: { 200: formVersionListSchema },
});

export const createFormDraft = defineRoute({
  ...round,
  method: 'POST',
  path: '/console/rounds/:roundId/form-versions',
  summary: "Start a draft of a round's form from its latest published version, or empty",
  responses: { 201: formVersionSchema },
});

export const getFormVersion = defineRoute({
  ...version,
  method: 'GET',
  path: '/console/form-versions/:formVersionId',
  summary: 'Read a form version with its definition',
  responses: { 200: formVersionSchema },
});

export const saveFormDraft = defineRoute({
  ...version,
  method: 'PUT',
  path: '/console/form-versions/:formVersionId/definition',
  summary: "Replace a draft's definition, checked by the form engine",
  body: formDraftInputSchema,
  responses: { 200: formVersionSchema },
});

export const publishFormDraft = defineRoute({
  ...version,
  method: 'POST',
  path: '/console/form-versions/:formVersionId/publish',
  summary: 'Publish a draft as a fixed version that new applications use',
  responses: { 200: formVersionSchema },
});

export const discardFormDraft = defineRoute({
  ...version,
  method: 'DELETE',
  path: '/console/form-versions/:formVersionId',
  summary: 'Discard a draft',
  responses: { 204: null },
});

export const formRoutes = {
  listFormVersions,
  createFormDraft,
  getFormVersion,
  saveFormDraft,
  publishFormDraft,
  discardFormDraft,
} as const;
