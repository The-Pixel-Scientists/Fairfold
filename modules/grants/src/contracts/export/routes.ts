// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 360Giving export routes (D14, D15), for members with `grants.data.export`
// over the whole tenant:
//
// - Reading and saving the funder's publisher details. Saving records a
//   configuration version and `grants.publisher_setting.changed`.
// - Exporting a programme's or a round's released awards as a 360Giving
//   file, built inside the request. It is refused with a problem when the
//   publisher details are missing or when more than MAX_EXPORT_GRANTS
//   grants match, and each export records `grants.export.downloaded` with
//   the programme or round and the number of grants.

import { defineRoute } from '@pixel-scientists/domain/api';

import { threeSixtyGivingExportSchema, threeSixtyGivingQuerySchema } from './360giving.ts';
import {
  publisherAnswerSchema,
  publisherSettingInputSchema,
  publisherSettingSchema,
} from './publisher.ts';

const exporter = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.data.export',
  scope: 'tenant',
} as const;

export const getPublisherSetting = defineRoute({
  ...exporter,
  method: 'GET',
  path: '/console/exports/360giving/publisher',
  summary: "Read the funder's 360Giving publisher details",
  responses: { 200: publisherAnswerSchema },
});

export const savePublisherSetting = defineRoute({
  ...exporter,
  method: 'PUT',
  path: '/console/exports/360giving/publisher',
  summary: "Save the funder's 360Giving publisher details",
  body: publisherSettingInputSchema,
  responses: { 200: publisherSettingSchema },
});

export const get360GivingExport = defineRoute({
  ...exporter,
  method: 'GET',
  path: '/console/exports/360giving',
  summary: "Export a programme's or round's released awards as a 360Giving file",
  query: threeSixtyGivingQuerySchema,
  responses: { 200: threeSixtyGivingExportSchema },
});

export const exportRoutes = {
  getPublisherSetting,
  savePublisherSetting,
  get360GivingExport,
} as const;
