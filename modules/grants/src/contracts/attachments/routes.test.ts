// SPDX-License-Identifier: AGPL-3.0-or-later

import { call, checkRoute, isRawBody, type Fetch } from '@pixel-scientists/domain/api';
import { fileTypes, MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import { describe, expect, it, vi } from 'vitest';

import * as attachments from './routes.ts';

const routes = Object.values(attachments.attachmentRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('attachment routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in attachmentRoutes', () => {
    const exported = Object.values(attachments).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it("let applicants reach their own applications' files, and staff a submission's", () => {
    expect(routes.map((route) => [`${route.method} ${route.path}`, route.scope])).toEqual([
      ['POST /portal/applications/:applicationId/fields/:fieldId/files', 'own_application'],
      ['GET /portal/applications/:applicationId/files', 'own_application'],
      ['DELETE /portal/applications/:applicationId/files/:fileId', 'own_application'],
      ['GET /portal/applications/:applicationId/files/:fileId', 'own_application'],
      ['GET /console/submissions/:submissionId/files', 'tenant'],
      ['GET /console/submissions/:submissionId/files/:fileId', 'tenant'],
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject(
        route.audience === 'portal'
          ? { module: 'grants', permission: 'grants.applications.apply' }
          : { audience: 'console', module: 'grants', permission: 'grants.applications.read' },
      );
    }
  });

  it("sit under the submission routes' path for one submission", () => {
    for (const route of routes.filter((route) => route.audience === 'console')) {
      expect(route.path.startsWith('/console/submissions/:submissionId/')).toBe(true);
    }
  });

  it('give no reviewer a route', () => {
    for (const route of routes) {
      expect(route.scope).not.toBe('assigned_review');
      expect(route.permission).not.toBe('grants.reviews.score');
    }
  });

  it('carry ids only, never a name, type or size', () => {
    const params = new Set(
      routes.flatMap((route) => route.path.split('/').filter((part) => part.startsWith(':'))),
    );
    expect(params).toEqual(new Set([':applicationId', ':fieldId', ':fileId', ':submissionId']));
    for (const route of routes) expect(route, route.path).not.toHaveProperty('query');
    const { uploadAttachment, downloadAttachment } = attachments;
    expect(
      uploadAttachment.params.safeParse({ applicationId: ID, fieldId: 'f_accounts' }).success,
    ).toBe(true);
    for (const bad of [
      { applicationId: ID, fieldId: 'Accounts.pdf' },
      { applicationId: ID, fieldId: 'f_accounts', name: 'Accounts.pdf' },
      { applicationId: 'x', fieldId: 'f_accounts' },
    ]) {
      expect(uploadAttachment.params.safeParse(bad).success).toBe(false);
    }
    expect(
      downloadAttachment.params.safeParse({ applicationId: ID, fileId: 'a.pdf' }).success,
    ).toBe(false);
  });

  it('take a file of up to MAX_FILE_BYTES as raw bytes', () => {
    expect(attachments.uploadAttachment.body).toEqual({
      raw: ['application/octet-stream'],
      maxBytes: MAX_FILE_BYTES,
    });
  });

  it("send a download in the file's stored type only", () => {
    for (const route of [
      attachments.downloadAttachment,
      attachments.downloadSubmissionAttachment,
    ]) {
      expect(route.responses).toEqual({ 200: { raw: fileTypes } });
    }
  });

  it('are refused by call() when they send or answer raw bytes', async () => {
    const fetch = vi.fn<Fetch>();
    const raw = routes.filter(
      (route) =>
        ('body' in route && isRawBody(route.body)) ||
        Object.values(route.responses).some(isRawBody),
    );
    expect(raw.map((route) => route.path)).toEqual([
      '/portal/applications/:applicationId/fields/:fieldId/files',
      '/portal/applications/:applicationId/files/:fileId',
      '/console/submissions/:submissionId/files/:fileId',
    ]);
    // @ts-expect-error call() takes JSON routes only.
    await expect(call(attachments.uploadAttachment, {}, { fetch })).rejects.toThrow(TypeError);
    // @ts-expect-error call() takes JSON routes only.
    await expect(call(attachments.downloadAttachment, {}, { fetch })).rejects.toThrow(TypeError);
    await expect(
      // @ts-expect-error call() takes JSON routes only.
      call(attachments.downloadSubmissionAttachment, {}, { fetch }),
    ).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
