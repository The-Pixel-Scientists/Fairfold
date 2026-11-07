// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { permissions } from '@pixel-scientists/domain/platform';
import * as shared from '@pixel-scientists/domain/platform/subject-access';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as jobs from './jobs.ts';

const routes = Object.values(jobs.exportJobRoutes);
const ids = (count: number) =>
  Array.from({ length: count }, (_, i) => `5c1d2e3f-4a5b-4c6d-8e7f-${String(i).padStart(12, '0')}`);
const [ID = ''] = ids(1);

describe('export job routes', () => {
  it('keep every route rule and are all listed in exportJobRoutes', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
    const exported = Object.values(jobs).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('need the export permission over the whole tenant', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'POST /console/csv-exports',
      'GET /console/csv-exports/:requestId',
      'POST /console/board-packs',
      'GET /console/board-packs/:requestId',
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.data.export',
        scope: 'tenant',
      });
    }
  });

  it('also need the requester to read applications, failing with a code once they cannot', () => {
    expect(jobs.EXPORT_READ_PERMISSION).toBe('grants.applications.read');
    expect(permissions[jobs.EXPORT_READ_PERMISSION].scopes).toContain('tenant');
    for (const route of routes) expect(route.permission).not.toBe(jobs.EXPORT_READ_PERMISSION);
    const failed = {
      id: ID,
      requestedAt: '2026-12-02T09:00:00.000Z',
      status: 'failed',
      failureCode: jobs.REQUESTER_CANNOT_READ,
    };
    expect(jobs.jobRequestSchema.parse(failed)).toEqual(failed);
  });

  it('ask idempotently after a recent sign-in, answering 202 with the request id', () => {
    for (const route of [jobs.requestCsvExport, jobs.requestBoardPack]) {
      expect(route, route.path).toMatchObject({ idempotent: true, stepUp: true });
      expect(Object.keys(route.responses), route.path).toEqual(['202']);
    }
  });

  it('read the status as the subject access request does', () => {
    const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'output' });
    for (const name of [
      'jobRequestSchema',
      'requestAcceptedSchema',
      'requestParamsSchema',
    ] as const) {
      expect(json(jobs[name]), name).toEqual(json(shared[name]));
    }
    for (const route of [jobs.readCsvExport, jobs.readBoardPack]) {
      expect(route.responses[200], route.path).toBe(jobs.jobRequestSchema);
      expect(route.params, route.path).toBe(jobs.requestParamsSchema);
    }
  });
});

describe('export requests', () => {
  it('name a saved view only: never columns, filters or a format', () => {
    expect(jobs.csvExportRequestSchema.parse({ viewId: ID })).toEqual({ viewId: ID });
    for (const extra of ['columns', 'filter', 'fields', 'tenantId']) {
      expect(jobs.csvExportRequestSchema.safeParse({ viewId: ID, [extra]: [] }).success).toBe(
        false,
      );
    }
  });

  it('name applications only, each once, at least one and at most the cap', () => {
    const { boardPackRequestSchema: schema, MAX_BOARD_PACK_APPLICATIONS: most } = jobs;
    expect(schema.safeParse({ applicationIds: ids(most) }).success).toBe(true);
    expect(schema.safeParse({ applicationIds: [] }).success).toBe(false);
    expect(schema.safeParse({ applicationIds: [ID, ID] }).success).toBe(false);
    expect(schema.safeParse({ applicationIds: ids(most + 1) }).success).toBe(false);
    for (const extra of ['templateId', 'mergeFields', 'layout']) {
      expect(schema.safeParse({ applicationIds: [ID], [extra]: 'x' }).success, extra).toBe(false);
    }
  });
});
