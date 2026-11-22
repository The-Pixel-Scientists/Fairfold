// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { isAuditAction, platformAuditActions } from '../platform/audit.ts';
import { messageForIssue } from '../platform/messages.ts';
import { configDiffSchemas, configEntityTypes } from '../platform/settings/config.ts';
import {
  documentFailureMessages,
  documentFailures,
  signatureEvents,
  signatureFailureMessages,
  signatureFailures,
  signatureRequestSchema,
  signatureStatusLabels,
  signatureStatuses,
  templateFieldMessages,
  templateFieldRefusals,
} from './index.ts';

describe('the documents contracts', () => {
  it('audit every status, evidence download, generated document and template publish', () => {
    const codes = [
      ...signatureStatuses
        .filter((status) => status !== 'draft')
        .map((status) => `platform.signature.${status}`),
      'platform.signature.requested',
      'platform.signature.callback_received',
      'platform.signature_evidence.downloaded',
      'platform.document.generated',
      'platform.document_template.published',
    ];
    for (const code of codes) expect(isAuditAction(code), code).toBe(true);
    expect(platformAuditActions).toContain('platform.file.downloaded');
  });

  it('version templates as configuration with a diff', () => {
    expect(configEntityTypes).toContain('platform.document_template');
    expect(Object.hasOwn(configDiffSchemas, 'platform.document_template')).toBe(true);
  });

  it('have words for every status, failure and refusal', () => {
    expect(Object.keys(signatureStatusLabels)).toEqual([...signatureStatuses]);
    expect(Object.keys(signatureFailureMessages)).toEqual([...signatureFailures]);
    expect(Object.keys(documentFailureMessages)).toEqual([...documentFailures]);
    expect(Object.keys(templateFieldMessages)).toEqual([...templateFieldRefusals]);
  });

  it("say what to fix in the catalogue's words, never repeating a value", () => {
    const person = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
    const parsed = signatureRequestSchema.safeParse({
      fileId: person,
      signers: [
        { personId: person, order: 1 },
        { personId: person, order: 2 },
      ],
      expiresAt: '2027-02-01T17:00:00Z',
    });
    expect(parsed.error?.issues.map(messageForIssue)).toEqual(['Add each signer once.']);
  });
});

describe('signature events', () => {
  const REQUEST = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';

  it('are one per status after draft, carrying the request id, status and time only', () => {
    expect(Object.values(signatureEvents).map((event) => event.name)).toEqual([
      'platform.signature_request_sent.v1',
      'platform.signature_request_viewed.v1',
      'platform.signature_request_signed.v1',
      'platform.signature_request_declined.v1',
      'platform.signature_request_expired.v1',
      'platform.signature_request_cancelled.v1',
      'platform.signature_request_failed.v1',
    ]);
    const data = {
      signatureRequestId: REQUEST,
      status: 'signed',
      changedAt: '2027-01-02T09:00:00Z',
    };
    expect(signatureEvents.signed.data.parse(data)).toEqual(data);
    expect(signatureEvents.declined.data.safeParse(data).success).toBe(false);
    const withPerson = { ...data, personId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' };
    expect(signatureEvents.signed.data.safeParse(withPerson).success).toBe(false);
  });
});
