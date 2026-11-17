// SPDX-License-Identifier: AGPL-3.0-or-later

import { idempotencyKeyHeader } from '@pixel-scientists/domain/api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotesPanel } from '../../../../modules/grants/src/console/submissions/notes/NotesPanel.tsx';
import { problem, stubApi } from '../testing/api.ts';
import { uuid } from './fixtures.ts';

const SUBMISSION = uuid(700);
const LIST = `GET /console/submissions/${SUBMISSION}/notes`;
const ADD = `POST /console/submissions/${SUBMISSION}/notes`;
const PEOPLE = `GET /console/submissions/${SUBMISSION}/mentionable-members`;

const ada = { membershipId: uuid(11), name: 'Ada Reed' };
const priya = { membershipId: uuid(12), name: 'Priya Shah' };
const tom = { membershipId: uuid(13), name: 'Tom Okafor' };

const note = (n: number, body: string, mentions = [priya]) => ({
  id: uuid(800 + n),
  body,
  author: ada,
  mentions,
  createdAt: '2026-10-22T09:30:00.000Z',
});

const reads = (notes: readonly object[] = []) => ({
  [LIST]: { status: 200, body: { notes } },
  [PEOPLE]: { status: 200, body: { members: [priya, tom] } },
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const field = () => screen.findByRole('textbox', { name: /Note for staff only/ });

describe('notes on a submission', () => {
  it('says there are no notes yet and that the applicant will not see them', async () => {
    stubApi(reads());
    render(<NotesPanel submissionId={SUBMISSION} />);

    expect(await screen.findByText(/No notes have been added yet/)).toBeTruthy();
    expect(await field()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit|Delete/ })).toBeNull();
  });

  it('lists notes as plain text with who wrote them and who they mention', async () => {
    stubApi(reads([note(1, '<b>Check the budget</b> at https://example.org/x', [priya, tom])]));
    render(<NotesPanel submissionId={SUBMISSION} />);

    const list = await screen.findByRole('list', { name: 'Notes, newest first' });
    expect(within(list).getByText('<b>Check the budget</b> at https://example.org/x')).toBeTruthy();
    expect(within(list).getByText(/Ada Reed, 22 October 2026/)).toBeTruthy();
    expect(within(list).getByText('Mentioned: Priya Shah, Tom Okafor')).toBeTruthy();
    expect(within(list).queryByRole('link')).toBeNull();
  });

  it('adds a note that mentions a colleague, sends ids and keeps text out of the address and title', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...reads(),
      [ADD]: (body) => ({
        status: 201,
        body: note(1, (body as { body: string }).body),
      }),
    });
    render(<NotesPanel submissionId={SUBMISSION} />);

    await user.type(await field(), 'Chase the missing accounts.');
    await user.type(screen.getByRole('combobox', { name: /Mention people/ }), 'pri');
    await user.click(await screen.findByRole('option', { name: 'Priya Shah' }));
    expect(screen.getByRole('list', { name: 'People mentioned' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    const list = await screen.findByRole('list', { name: 'Notes, newest first' });
    expect(within(list).getByText('Chase the missing accounts.')).toBeTruthy();
    const post = sent.find(({ key }) => key === ADD);
    expect(post?.body).toEqual({
      body: 'Chase the missing accounts.',
      mentions: [priya.membershipId],
    });
    expect(screen.getByText('Note added')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(list).getAllByRole('listitem')[0]);
    });
    expect(window.location.href).not.toContain('accounts');
    expect(document.title).not.toContain('accounts');
    expect((await field()).textContent).toBe('');
  });

  it('refuses a blank note and one that is too long without sending, and says how to fix it', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads());
    render(<NotesPanel submissionId={SUBMISSION} />);

    await user.type(await field(), '   {Enter}  ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText(/Enter a note\./)).toBeTruthy();

    const box = await field();
    await user.clear(box);
    await user.click(box);
    await user.paste('x'.repeat(5001));
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Shorten this to 5000 characters or fewer.')).toBeTruthy();
    expect(sent.some(({ key }) => key === ADD)).toBe(false);
  });

  it('keeps the body and the other people when a mention is refused, and marks the one to remove', async () => {
    const user = userEvent.setup();
    stubApi({
      ...reads(),
      [ADD]: problem(422, 'Check the note and try again.', [
        {
          field: 'body.mentions.1',
          message: 'One of the people you mentioned cannot see this application.',
        },
      ]),
    });
    render(<NotesPanel submissionId={SUBMISSION} />);

    await user.type(await field(), 'Please look.');
    const picker = screen.getByRole('combobox', { name: /Mention people/ });
    for (const name of ['Priya Shah', 'Tom Okafor']) {
      await user.type(picker, name.slice(0, 3));
      await user.click(await screen.findByRole('option', { name }));
    }
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    const chips = await screen.findByRole('list', { name: 'People mentioned' });
    const [first, second] = within(chips).getAllByRole('listitem');
    expect(second?.textContent).toContain('Tom Okafor');
    expect(second?.textContent).toContain('cannot see this application');
    expect(first?.textContent).not.toContain('cannot see');
    expect((await field()).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Remove the people who cannot see this application/)).toBeTruthy();
    const remove = within(chips).getByRole('button', { name: /Remove\s*Tom Okafor/ });
    expect(remove.getAttribute('aria-describedby')).toBe(second?.querySelector('span[id]')?.id);
    expect(
      within(first as HTMLElement)
        .getByRole('button')
        .getAttribute('aria-describedby'),
    ).toBeNull();
    expect(((await field()) as HTMLTextAreaElement).value).toBe('Please look.');
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: /Note for staff only/ }),
      );
    });
  });

  it('cannot pick a person twice, removes the last with Backspace and stops at ten', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 11 }, (_, n) => ({
      membershipId: uuid(900 + n),
      name: `Member ${String.fromCharCode(65 + n)}`,
    }));
    stubApi({
      [LIST]: { status: 200, body: { notes: [] } },
      [PEOPLE]: { status: 200, body: { members: many } },
    });
    render(<NotesPanel submissionId={SUBMISSION} />);
    const picker = await screen.findByRole('combobox', { name: /Mention people/ });

    await user.type(picker, 'Member A');
    await user.click(await screen.findByRole('option', { name: 'Member A' }));
    await user.type(picker, 'Member A');
    expect(screen.queryByRole('option', { name: 'Member A' })).toBeNull();
    await user.clear(picker);
    await user.keyboard('{Backspace}');
    expect(screen.queryByRole('list', { name: 'People mentioned' })).toBeNull();
    expect(screen.getByText('Member A removed.')).toBeTruthy();

    for (const person of many.slice(0, 10)) {
      await user.type(picker, person.name);
      await user.keyboard('{ArrowDown}{Enter}');
    }
    expect(
      within(screen.getByRole('list', { name: 'People mentioned' })).getAllByRole('listitem'),
    ).toHaveLength(10);
    expect(screen.getByText(/You can mention up to 10 people/)).toBeTruthy();
  });

  it('adds one note when the button is pressed twice', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...reads(),
      [ADD]: { status: 201, body: note(1, 'One note.', []) },
    });
    render(<NotesPanel submissionId={SUBMISSION} />);

    await user.type(await field(), 'One note.');
    await user.dblClick(screen.getByRole('button', { name: 'Add note' }));
    await screen.findByRole('list', { name: 'Notes, newest first' });

    expect(sent.filter(({ key }) => key === ADD)).toHaveLength(1);
  });

  it('tries again after a lost answer under the same key', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      ...reads(),
      [ADD]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(503, 'The service is busy. Try again.')
          : { status: 201, body: note(1, 'One note.', []) };
      },
    });
    render(<NotesPanel submissionId={SUBMISSION} />);

    await user.type(await field(), 'One note.');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await screen.findByRole('list', { name: 'Notes, newest first' });

    const keys = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => (init?.headers as Record<string, string>)[idempotencyKeyHeader]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });
});
