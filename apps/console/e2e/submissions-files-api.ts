// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the specs on a submission's files: the stand-in
// of submissions-api.ts, with one submission whose form has three file
// questions and an applicant-only one. It lists that submission's files as
// the contract does and sends them as the download route does: as an
// attachment, with `nosniff`, and without the file's name in any address.

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import type { Page } from '@playwright/test';

import { crowd, detail, stubSubmissions } from './submissions-api.ts';

const PDF = 'application/pdf';
const PNG = 'image/png';

const question = (id: string, label: string, more: object = {}) => ({
  id,
  type: 'file',
  label,
  required: false,
  allowedTypes: [PDF, PNG],
  maxBytes: 5_000_000,
  maxFiles: 3,
  ...more,
});

const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_docs',
      title: 'Documents',
      fields: [
        question('f_accounts', 'Latest accounts'),
        question('f_photos', 'Photos of the hall'),
        question('f_plan', 'Project plan'),
        question('f_private', 'Applicant notes', { audiences: ['applicant'] }),
      ],
    },
  ],
});

const fileId = (n: number) => `00000000-0000-4000-8000-${String(5000 + n).padStart(12, '0')}`;

/** What a file question holds. The size is that of its bytes, so a download can be checked against it. */
export const attachments = [
  { n: 1, fieldId: 'f_accounts', name: 'accounts-2026.pdf', type: PDF, text: '%PDF-1.4 accounts' },
  { n: 2, fieldId: 'f_photos', name: 'hall front.png', type: PNG, text: 'front of the hall' },
  { n: 3, fieldId: 'f_photos', name: 'hall back.png', type: PNG, text: 'back of the hall' },
  { n: 4, fieldId: 'f_private', name: 'notes.pdf', type: PDF, text: '%PDF-1.4 notes' },
].map(({ n, text, ...file }) => ({
  ...file,
  id: fileId(n),
  bytes: Buffer.byteLength(text),
  uploadedAt: '2026-10-20T12:00:00.000Z',
  body: text,
}));

/**
 * A stand-in whose submission has `files`, less the applicant only
 * question's, which the API leaves out for staff. `downloaded` lists the
 * addresses the download route was asked for.
 */
export async function stubFiles(page: Page, files = attachments) {
  const held = crowd();
  const target = held[1];
  if (target === undefined) throw new Error('The stand-in has no submissions.');
  await stubSubmissions(page, held);
  const downloaded: string[] = [];
  const base = `/api/console/submissions/${target.id}`;
  const sent = files.filter(({ fieldId }) => fieldId !== 'f_private');

  await page.route(
    (url) => url.pathname === base || url.pathname.startsWith(`${base}/files`),
    async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === base) {
        const full = detail(target);
        return route.fulfill({
          json: { ...full, form: { ...full.form, definition }, answers: {} },
        });
      }
      if (pathname === `${base}/files`) {
        return route.fulfill({
          json: { attachments: sent.map((file) => ({ ...file, body: undefined })) },
        });
      }
      downloaded.push(pathname);
      const file = sent.find(({ id }) => pathname === `${base}/files/${id}`);
      if (file === undefined) return route.fulfill({ status: 404, json: {} });
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': file.type,
          'content-disposition': `attachment; filename="${file.name}"`,
          'x-content-type-options': 'nosniff',
        },
        body: file.body,
      });
    },
  );
  return { id: target.id, downloaded };
}
