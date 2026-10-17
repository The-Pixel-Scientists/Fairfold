// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Files in the apply journey: attaching them to a question, seeing and
// removing them, and finding them on the check page and after sending. A
// file's name is shown on screen and sent in one header, and nowhere else.

import { fileRefusalMessages } from '@pixel-scientists/domain/files';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import type { Application, AttachmentView } from '@pixel-scientists/grants/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import type { Reply } from '../testing/api.ts';
import {
  APPLICATION_ID,
  FILE_ID,
  application,
  applicationServer,
  attachment,
  completeAnswers,
} from '../testing/apply.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';
import { stubUploads } from '../testing/upload.ts';
import { SAVE_DELAY_MS } from './useAutosave.ts';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const budget = `${home}/sections/s_budget`;
const check = `${home}/check`;
const FILES = `/api/portal/applications/${APPLICATION_ID}/files`;
const NEW_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const enough = { timeout: SAVE_DELAY_MS * 5 };
const eligible = application({ answers: { f_charity: true } });

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const input = () => screen.getByLabelText<HTMLInputElement>('Choose file');
const list = () => screen.queryByRole('list', { name: 'Files for Your latest accounts' });
const summary = () => screen.findByRole('alert', { name: 'There is a problem' });

/** A file that starts as a PDF does. */
const pdf = (name = 'trustees report.pdf') =>
  new File(['%PDF-1.7 report'], name, { type: 'application/pdf' });

const stored = (file: File, id = NEW_ID): Reply => ({
  status: 201,
  body: attachment({ id, name: file.name, bytes: file.size }),
});

function open(
  path: string,
  {
    start = eligible,
    files = [],
    more = {},
  }: { start?: Application; files?: AttachmentView[]; more?: Record<string, Reply> } = {},
) {
  const server = applicationServer(start, files);
  const sent = stubApi({ ...signedIn, ...server.handlers, ...more });
  const uploads = stubUploads();
  openPortal(path);
  return { server, sent, uploads };
}

async function choose(user: ReturnType<typeof userEvent.setup>, file = pdf()) {
  await user.upload(await screen.findByLabelText('Choose file'), file);
  return file;
}

describe('a section with a file question', () => {
  it('shows the files attached, each a link made from ids, and says what is accepted', async () => {
    open(budget, { files: [attachment()] });
    await h1('Budget');

    const link = await screen.findByRole('link', {
      name: 'Download accounts-2026.pdf, PDF, 2.1 MB',
    });
    expect(link.getAttribute('href')).toBe(`${FILES}/${FILE_ID}`);
    expect(screen.queryByLabelText('Choose file')).toBeNull();
    expect(screen.getByText(/^You have reached the limit of 1 file\./)).toBeTruthy();
  });

  it('says in words what a question takes before anything is chosen', async () => {
    open(budget);
    await h1('Budget');

    expect(await screen.findByText(/^PDF, Word document, .*, up to 10 MB\./)).toBeTruthy();
    expect(screen.getByText('A PDF or Word document.')).toBeTruthy();
    expect(list()).toBeNull();
  });

  it('sends the file with its name in a header, shows it going, then lists it', async () => {
    const user = userEvent.setup();
    const { uploads, sent } = open(budget);
    await h1('Budget');

    const file = await choose(user);

    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });
    const [upload] = uploads;
    expect(upload?.method).toBe('POST');
    expect(upload?.url).toBe(`/api/portal/applications/${APPLICATION_ID}/fields/f_accounts/files`);
    expect(upload?.headers['file-name']).toBe('trustees%20report.pdf');
    expect(upload?.headers['content-type']).toBe('application/octet-stream');
    expect(await screen.findByText('Uploading trustees report.pdf, 0%')).toBeTruthy();

    await upload?.progress(file.size / 2);
    expect(await screen.findByText('Uploading trustees report.pdf, 50%')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: /^Uploading trustees report\.pdf/ }),
    ).toBeTruthy();
    await upload?.progress(file.size);
    // Once on the page, and once in the live region that announces it.
    expect(await screen.findAllByText('Checking trustees report.pdf for viruses')).toHaveLength(2);
    await upload?.reply(stored(file));

    const link = await screen.findByRole('link', {
      name: /^Download trustees report\.pdf, PDF, /,
    });
    expect(link.getAttribute('href')).toBe(`${FILES}/${NEW_ID}`);
    expect(screen.queryByLabelText('Choose file')).toBeNull();

    // The name is on the screen and in the header, and in no address, title or other request.
    expect(document.title).not.toMatch(/trustees/i);
    expect(window.location.href).not.toMatch(/trustees/i);
    expect(JSON.stringify(sent)).not.toMatch(/trustees/i);
    expect(upload?.url).not.toMatch(/trustees/i);
  });

  it('keeps saving other answers while a file goes up', async () => {
    const user = userEvent.setup();
    const { uploads, server } = open(budget);
    await h1('Budget');
    await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });

    await user.click(await screen.findByRole('button', { name: 'Add the first cost' }));
    await user.type(screen.getByRole('textbox', { name: /^Item/ }), 'Hall hire');

    await waitFor(() => {
      expect(server.saved).toHaveLength(1);
    }, enough);
    expect(server.saved[0]?.answers).toMatchObject({ f_costs: [{ c_item: 'Hall hire' }] });
    // The file is still on its way, and the answers never carry a file.
    expect(uploads[0]?.aborted).toBe(false);
    expect(JSON.stringify(server.saved)).not.toMatch(/f_accounts/);
  });

  it('asks before leaving while a file is uploading, and carries on if the applicant stays', async () => {
    const user = userEvent.setup();
    const { uploads } = open(budget);
    await h1('Budget');
    const file = await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));

    await user.click(crumbs.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(
      within(dialog).getByText(
        'A file is still uploading. If you leave this page, it will not be added.',
      ),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(window.location.pathname).toBe(budget);
    await uploads[0]?.reply(stored(file));
    await screen.findByRole('link', { name: /^Download trustees report\.pdf/ });

    // Nothing is uploading or unsaved now, so leaving does not ask.
    await user.click(crumbs.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' }));
    expect(await h1('Your application')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stops an upload that is still on its way when the applicant leaves', async () => {
    const user = userEvent.setup();
    const { uploads } = open(budget);
    await h1('Budget');
    await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });

    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Community Spaces Fund, Spring 2027',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Leave and lose changes' }));

    await h1('Your application');
    expect(uploads[0]?.aborted).toBe(true);
  });

  it('keeps every other answer when a file is refused, and says what to do next', async () => {
    const user = userEvent.setup();
    const { uploads, server } = open(budget);
    await h1('Budget');
    await user.click(await screen.findByRole('button', { name: 'Add the first cost' }));
    await user.type(screen.getByRole('textbox', { name: /^Item/ }), 'Hall hire');
    await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });

    await uploads[0]?.reply(problem(422, fileRefusalMessages.infected));

    const words =
      'trustees report.pdf: This file has a virus in it, so it was not uploaded. Check the file and try again.';
    expect(within(await summary()).getByText(words)).toBeTruthy();
    expect(screen.getAllByText(words)).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: /^Item/ })).toHaveProperty('value', 'Hall hire');
    expect(list()).toBeNull();
    // The choice is still there, and the answers still save.
    expect(screen.getByLabelText('Choose file')).toBeTruthy();
    await waitFor(() => {
      expect(server.current.answers).toMatchObject({ f_costs: [{ c_item: 'Hall hire' }] });
    }, enough);
  });

  it.each([
    ['too many files', 'too_many'],
    ['the wrong type', 'type_not_allowed'],
    ['a file that could not be checked', 'not_checked'],
  ] as const)('shows the words for %s from the server', async (_name, code) => {
    const user = userEvent.setup();
    const { uploads } = open(budget);
    await h1('Budget');
    await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });

    await uploads[0]?.reply(problem(422, fileRefusalMessages[code]));

    expect(
      within(await summary()).getByText(`trustees report.pdf: ${fileRefusalMessages[code]}`),
    ).toBeTruthy();
  });

  it('says what to do when the session ended before the file went up', async () => {
    const user = userEvent.setup();
    const { uploads } = open(budget);
    await h1('Budget');
    await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });

    await uploads[0]?.reply(problem(401, 'You are not signed in.'));

    expect(
      within(await summary()).getByText(
        'trustees report.pdf: You were signed out, so the file was not added. Sign in again, then attach it again.',
      ),
    ).toBeTruthy();
  });

  it('checks the type in the browser first, and sends nothing for a file that is refused there', async () => {
    const user = userEvent.setup();
    const { uploads } = open(budget);
    await h1('Budget');

    await choose(user, new File(['not a pdf at all'], 'notes.pdf', { type: 'application/pdf' }));

    expect(within(await summary()).getByText(/^notes\.pdf: The file must be /)).toBeTruthy();
    expect(uploads).toHaveLength(0);
  });

  it('says when the connection fails, and a second try works', async () => {
    const user = userEvent.setup();
    const { uploads } = open(budget);
    await h1('Budget');
    await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });

    await uploads[0]?.fail();

    expect(
      within(await summary()).getByText(
        'trustees report.pdf: We could not reach the service. Check your connection and try again.',
      ),
    ).toBeTruthy();
    const file = await choose(user);
    await waitFor(() => {
      expect(uploads).toHaveLength(2);
    });
    await uploads[1]?.reply(stored(file));

    expect(
      await screen.findByRole('link', { name: /^Download trustees report\.pdf/ }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert', { name: 'There is a problem' })).toBeNull();
  });

  it('removes a file, and puts focus on the way to attach another', async () => {
    const user = userEvent.setup();
    const { server, sent } = open(budget, { files: [attachment()] });
    await h1('Budget');

    await user.click(await screen.findByRole('button', { name: 'Remove accounts-2026.pdf' }));

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /^Download accounts-2026\.pdf/ })).toBeNull();
    });
    expect(sent.map(({ key }) => key)).toContain(
      `DELETE /portal/applications/${APPLICATION_ID}/files/${FILE_ID}`,
    );
    expect(server.files).toEqual([]);
    await waitFor(() => {
      expect(document.activeElement).toBe(input());
    });
  });

  it('says so when a file cannot be removed, and keeps it', async () => {
    const user = userEvent.setup();
    open(budget, {
      files: [attachment()],
      more: {
        [`DELETE /portal/applications/${APPLICATION_ID}/files/${FILE_ID}`]: problem(503, 'Busy.'),
      },
    });
    await h1('Budget');

    await user.click(await screen.findByRole('button', { name: 'Remove accounts-2026.pdf' }));

    expect(
      await screen.findByText('We could not remove the file. Check your connection and try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Download accounts-2026\.pdf/ })).toBeTruthy();
  });

  it('never sends a file as an answer, and does not block "Save and continue" for a missing one', async () => {
    const user = userEvent.setup();
    const { server } = open(budget, { files: [attachment()] });
    await h1('Budget');

    await user.click(await screen.findByRole('button', { name: 'Add the first cost' }));
    await user.type(screen.getByRole('textbox', { name: /^Item/ }), 'Hall hire');
    await waitFor(() => {
      expect(server.saved).toHaveLength(1);
    }, enough);

    expect(JSON.stringify(server.saved)).not.toContain(FILE_ID);
    expect(server.saved[0] && Object.keys(server.saved[0].answers)).not.toContain('f_accounts');
  });
});

describe('a section with several file questions', () => {
  const definition = formDefinitionSchema.parse({
    sections: [
      {
        id: 's_documents',
        title: 'Documents',
        fields: [
          { id: 'f_accounts', type: 'file', label: 'Your latest accounts', required: true },
          { id: 'f_policy', type: 'file', label: 'Your safeguarding policy' },
        ],
      },
    ],
  });
  const documents = application({
    form: { id: '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70', definition },
  });
  const meter = () =>
    screen
      .findByRole('meter', { name: 'Documents added' })
      .then((found) => found.getAttribute('aria-valuetext'));

  it('counts the documents added, and says each file is saved as it uploads', async () => {
    const user = userEvent.setup();
    const { uploads } = open(`${home}/sections/s_documents`, { start: documents });
    await h1('Documents');

    expect(await meter()).toBe('0 of 2');
    expect(
      screen.getByText(
        'We save your answers as you type, and each file as soon as it uploads. You can leave at any time.',
      ),
    ).toBeTruthy();
    const file = pdf();
    const [accounts] = await screen.findAllByLabelText<HTMLInputElement>('Choose file');
    if (accounts === undefined) throw new Error('The section has no file question.');
    await user.upload(accounts, file);
    await waitFor(() => {
      expect(uploads).toHaveLength(1);
    });
    expect(uploads[0]?.url).toBe(
      `/api/portal/applications/${APPLICATION_ID}/fields/f_accounts/files`,
    );
    await uploads[0]?.reply(stored(file));

    await waitFor(async () => {
      expect(await meter()).toBe('1 of 2');
    });
  });

  it('shows no count for a section with one file question', async () => {
    open(budget);
    await h1('Budget');

    await screen.findByLabelText('Choose file');
    expect(screen.queryByRole('meter', { name: 'Documents added' })).toBeNull();
  });
});

describe('the application task list', () => {
  it('counts a section with its file as complete only once the file is attached', async () => {
    open(home, { start: application({ answers: completeAnswers }) });

    expect(
      (await screen.findByRole('meter', { name: 'Sections completed' })).getAttribute(
        'aria-valuetext',
      ),
    ).toBe('3 of 4');
    expect(screen.getByText('1 question to finish.')).toBeTruthy();
  });
});

describe('check your answers', () => {
  it('lists each question’s files with a link to download them', async () => {
    open(check, { start: application({ answers: completeAnswers }), files: [attachment()] });
    await h1('Check your answers');

    const link = await screen.findByRole('link', {
      name: 'Download accounts-2026.pdf, PDF, 2.1 MB',
    });
    expect(link.getAttribute('href')).toBe(`${FILES}/${FILE_ID}`);
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeTruthy();
  });

  it('lists a missing required file with a link to its question, and offers no submit', async () => {
    open(check, { start: application({ answers: completeAnswers }) });

    const missing = await screen.findByRole('region', {
      name: 'Before you can send your application',
    });
    const link = within(missing).getByRole('link', {
      name: 'Your latest accounts: Upload a file for this question.',
    });
    expect(link.getAttribute('href')).toBe(`${budget}#f_accounts`);
    expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
  });

  it('opens the question for a missing file, with the way to attach one in focus', async () => {
    const user = userEvent.setup();
    open(check, { start: application({ answers: completeAnswers }) });
    await user.click(
      await screen.findByRole('link', {
        name: 'Your latest accounts: Upload a file for this question.',
      }),
    );

    await h1('Budget');
    await waitFor(() => {
      expect(document.activeElement).toBe(input());
    });
  });

  it('cannot say what is missing without the files, so it says so and offers to try again', async () => {
    open(check, {
      start: application({ answers: completeAnswers }),
      more: { [`GET /portal/applications/${APPLICATION_ID}/files`]: problem(503, 'Busy.') },
    });

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
  });
});

describe('the confirmation', () => {
  it('lists the files that were sent, with links to download them', async () => {
    open(`${home}/submitted`, {
      start: application({
        answers: completeAnswers,
        status: 'submitted',
        submittedAt: '2026-10-21T14:14:00.000Z',
      }),
      files: [attachment()],
    });

    expect(await screen.findByRole('heading', { level: 2, name: 'Files you sent' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Download accounts-2026.pdf, PDF, 2.1 MB' })
        .getAttribute('href'),
    ).toBe(`${FILES}/${FILE_ID}`);
  });

  it('has no list of files when none were sent', async () => {
    open(`${home}/submitted`, {
      start: application({ status: 'submitted', submittedAt: '2026-10-21T14:14:00.000Z' }),
    });

    await h1('Application submitted');
    expect(screen.queryByRole('heading', { name: 'Files you sent' })).toBeNull();
  });
});
