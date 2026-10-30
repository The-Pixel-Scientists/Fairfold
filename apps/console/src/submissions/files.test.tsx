// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stored } from '../forms/fixtures.ts';
import { stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, detail, manager, ok, page, programmes, stages, summary, uuid } from './fixtures.ts';

setUpConsoleTests();

const PDF = 'application/pdf';
const file = (field: string) => ({
  type: 'file',
  required: false,
  allowedTypes: [PDF, 'image/png'],
  maxBytes: 5_000_000,
  maxFiles: 3,
  label: field,
});

const definition = stored({
  sections: [
    {
      id: 's_docs',
      title: 'Documents',
      fields: [
        { id: 'f_accounts', ...file('Latest accounts') },
        { id: 'f_photos', ...file('Photos of the hall') },
        { id: 'f_plan', ...file('Project plan') },
        { id: 'f_private', ...file('Applicant notes'), audiences: ['applicant'] },
      ],
    },
  ],
});

const attachment = (n: number, fieldId: string, name: string, type: string, bytes: number) => ({
  id: uuid(500 + n),
  fieldId,
  name,
  type,
  bytes,
  uploadedAt: '2026-10-20T12:00:00.000Z',
});

const one = detail({ form: { id: uuid(300), version: 3, definition }, answers: {} });

function open(attachments: ReturnType<typeof attachment>[]) {
  stubApi({
    ...manager(),
    [api.programmes]: ok(programmes),
    [api.stages]: ok({ stages }),
    [api.one(one.id)]: ok(one),
    [api.files(one.id)]: ok({ attachments }),
    [api.assignments(one.id)]: ok({ assignments: [] }),
    [api.list()]: ok(page([summary(1)])),
  });
  openConsole(`/northfield/submissions/${one.id}`);
}

/** The answer to one question: the cell beside its label. */
const answerTo = (panel: HTMLElement, label: string) =>
  within(panel).getByText(label).closest('div')?.querySelector('dd');

describe('the files on a submission', () => {
  it('lists each file question’s files as downloads, and says "No files uploaded" for one with none', async () => {
    open([
      attachment(1, 'f_accounts', 'accounts-2026.pdf', PDF, 48_213),
      attachment(2, 'f_photos', 'hall front.png', 'image/png', 2_202_010),
      attachment(3, 'f_photos', 'hall back.png', 'image/png', 856_064),
    ]);

    const panel = await screen.findByRole('tabpanel', { name: 'Application' });
    const accounts = within(answerTo(panel, 'Latest accounts') as HTMLElement);
    expect(
      accounts.getByRole('link', { name: 'Download accounts-2026.pdf, PDF, 47 KB' }),
    ).toBeTruthy();
    const photos = within(answerTo(panel, 'Photos of the hall') as HTMLElement);
    expect(photos.getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Download hall front.png, PNG image, 2.1 MB',
      'Download hall back.png, PNG image, 836 KB',
    ]);
    expect(answerTo(panel, 'Project plan')?.textContent).toBe('No files uploaded');
  });

  it('makes each link from ids, never from the name, so a name cannot change where it goes', async () => {
    const name = '../../x?a=1#b.pdf';
    open([attachment(1, 'f_accounts', name, PDF, 100)]);

    const link = await screen.findByRole('link', { name: `Download ${name}, PDF, 100 B` });
    expect(link.getAttribute('href')).toBe(`/api/console/submissions/${one.id}/files/${uuid(501)}`);
    expect(link.textContent).toBe(name);
  });

  it('shows no file on a question that staff may not see', async () => {
    open([
      attachment(1, 'f_accounts', 'accounts-2026.pdf', PDF, 100),
      attachment(2, 'f_private', 'private-notes.pdf', PDF, 100),
    ]);

    const panel = await screen.findByRole('tabpanel', { name: 'Application' });
    expect(within(panel).getByText('accounts-2026.pdf')).toBeTruthy();
    expect(within(panel).queryByText('Applicant notes')).toBeNull();
    expect(within(panel).queryByText('private-notes.pdf')).toBeNull();
  });
});
