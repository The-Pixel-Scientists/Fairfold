// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileViewSchema } from '@pixel-scientists/domain/files';
import { describe, expect, it } from 'vitest';

import {
  attachmentListSchema,
  attachmentMessages,
  attachmentViewSchema,
  MAX_ATTACHMENT_BYTES,
} from './answers.ts';

const view = {
  id: '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5',
  name: 'Accounts 2025.pdf',
  type: 'application/pdf',
  bytes: 48_213,
  uploadedAt: '2026-10-09T10:15:00Z',
  fieldId: 'f_accounts',
};

describe('attachment views', () => {
  it("are the file view and the question's field id", () => {
    expect(attachmentViewSchema.parse(view)).toEqual(view);
    expect(Object.keys(attachmentViewSchema.shape)).toEqual([
      ...Object.keys(fileViewSchema.shape),
      'fieldId',
    ]);
    expect(attachmentListSchema.parse({ attachments: [view] })).toEqual({ attachments: [view] });
  });

  it('are strict: no storage key, hash, uploader, tenant, scan detail or application', () => {
    for (const key of [
      'storageKey',
      'sha256',
      'createdBy',
      'tenantId',
      'scanState',
      'applicationId',
    ]) {
      expect(attachmentViewSchema.safeParse({ ...view, [key]: 'x' }).success, key).toBe(false);
    }
    expect(attachmentListSchema.safeParse({ attachments: [], totalBytes: 1 }).success).toBe(false);
    for (const fieldId of ['accounts', 'f_Accounts', undefined]) {
      expect(attachmentViewSchema.safeParse({ ...view, fieldId }).success).toBe(false);
    }
  });
});

describe('the limit on an application', () => {
  it('is 100 MiB, and its refusal says what went wrong and what to do', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(104_857_600);
    expect(attachmentMessages.applicationFull).toMatch(/^[A-Z][^.]*\.( [A-Z][^.]*[.])+$/);
    expect(attachmentMessages.applicationFull).toContain('100 MB');
  });
});
