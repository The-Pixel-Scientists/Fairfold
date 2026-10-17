// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import {
  actionButton,
  editor,
  openDraft,
  questionButton,
  SAVE,
  saves,
  savedDefinition,
  sectionButton,
} from './builder.ts';
import { api, draft, ids, ok, organisationForm, published, reads, version } from './fixtures.ts';

setUpConsoleTests();

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Save draft' }));

const summary = () => screen.findByRole('alert', { name: 'There is a problem' });

const keys = (sent: readonly { key: string }[]) => sent.map(({ key }) => key);

describe('saving a draft', () => {
  it('says whether the changes are saved, and sends the whole definition when asked', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    expect(screen.getByText('Saved 14 October 2026 at 2:15pm.')).toBeTruthy();
    expect(keys(sent)).not.toContain(SAVE);

    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), ' in full');
    expect(screen.getByText('You have changes that are not saved.')).toBeTruthy();
    await save(user);

    expect(await screen.findByText('Saved 15 October 2026 at 11am.')).toBeTruthy();
    const definition = savedDefinition(sent);
    expect(definition.sections.map((section) => section.title)).toEqual([
      'About your organisation',
      'Your project',
    ]);
    expect(definition.sections[0]?.fields[0]).toMatchObject({
      id: 'f_name',
      label: 'Organisation name in full',
      identity: true,
    });
    expect(definition.sections[1]?.fields).toEqual(organisationForm.sections[1]?.fields);
  });

  it('sends nothing when nothing has changed', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);

    await save(user);

    expect(keys(sent)).not.toContain(SAVE);
    expect(screen.getByText('Saved 14 October 2026 at 2:15pm.')).toBeTruthy();
  });

  it('asks before leaving with changes that are not saved, and keeps them when the person stays', async () => {
    const user = userEvent.setup();
    await openDraft(saves);
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), '!');

    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Form',
      }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Leave this page?' });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Stay on this page' }),
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(editor()).getByRole('textbox', { name: 'Question' })).toHaveProperty(
      'value',
      'Organisation name!',
    );

    await save(user);
    await screen.findByText(/^Saved 15 October/);
    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Form',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the problems of a draft', () => {
  it('stay quiet while the form is built, then show beside each box and in a summary, and send nothing', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(editor('Edit section')).queryByText(/Enter at least/)).toBeNull();

    await save(user);

    const errors = await summary();
    await waitFor(() => {
      expect(document.activeElement).toBe(errors);
    });
    expect(
      within(errors)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Section 3: Enter at least 1 character.',
      'Section 3, question 1: Enter at least 1 character.',
    ]);
    const title = within(editor('Edit section')).getByRole('textbox', { name: 'Title' });
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(within(editor('Edit section')).getByText('Enter at least 1 character.')).toBeTruthy();
    expect(sectionButton('Untitled section').textContent).toContain('Has a problem');
    expect(keys(sent)).not.toContain(SAVE);
  });

  it('link from the summary to the box, and to the question in the list when it is not selected', async () => {
    const user = userEvent.setup();
    await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await save(user);
    const errors = await summary();

    await user.click(within(errors).getByRole('link', { name: /^Section 3: / }));
    expect(document.activeElement).toBe(
      within(editor('Edit section')).getByRole('textbox', { name: 'Title' }),
    );

    await user.click(within(errors).getByRole('link', { name: /^Section 3, question 1/ }));
    expect(document.activeElement).toBe(questionButton('Untitled question'));
    expect(questionButton('Untitled question').textContent).toContain('Has a problem');
  });

  it('clear as they are fixed, and the draft then saves', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await save(user);
    await summary();

    await user.type(
      within(editor('Edit section')).getByRole('textbox', { name: 'Title' }),
      'Budget',
    );
    expect(within(await summary()).getAllByRole('link')).toHaveLength(1);
    await user.click(questionButton('Untitled question'));
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), 'Total cost');
    expect(screen.queryByRole('alert', { name: 'There is a problem' })).toBeNull();
    await save(user);

    await screen.findByText(/^Saved 15 October/);
    expect(savedDefinition(sent).sections[2]).toMatchObject({
      title: 'Budget',
      fields: [{ label: 'Total cost' }],
    });
  });

  it('include the rules between questions, such as a condition that reads a later question', async () => {
    const user = userEvent.setup();
    await openDraft(saves);
    await user.click(questionButton('Is your organisation a registered charity?'));
    await user.click(actionButton('Move down', 'Is your organisation a registered charity?'));

    await save(user);

    const errors = await summary();
    expect(errors.textContent).toContain(
      'Section 1, question 2: Choose a question that comes before this one.',
    );
  });
});

describe('what the server refuses', () => {
  it("is shown beside the box it names, in the server's words, and goes when the draft is edited", async () => {
    const user = userEvent.setup();
    const words =
      'f_name was another type of question in an earlier version. Keep its type, or add a new question with a new id.';
    await openDraft({
      [SAVE]: problem(400, 'Some fields are not valid. Fix the fields listed and try again.', [
        { field: 'body.definition.sections.0.fields.0.type', message: words },
      ]),
    });
    await user.click(questionButton('Registered charity number'));
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), '!');

    await save(user);

    const errors = await summary();
    expect(errors.textContent).toContain(`Section 1, question 1: ${words}`);
    expect(questionButton('Organisation name').getAttribute('aria-current')).toBe('true');
    expect(within(editor()).getByText(words)).toBeTruthy();
    expect(
      within(editor()).getByRole('combobox', { name: 'Type' }).getAttribute('aria-invalid'),
    ).toBe('true');

    await user.selectOptions(within(editor()).getByRole('combobox', { name: 'Type' }), 'Date');
    expect(within(editor()).queryByText(words)).toBeNull();
  });

  it('says so when the draft changed while the person worked, linking to the save button', async () => {
    const user = userEvent.setup();
    await openDraft({
      [SAVE]: problem(
        409,
        'This draft changed while you were working on it. Reload it and try again.',
      ),
    });
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), '!');

    await save(user);

    const errors = await summary();
    expect(errors.textContent).toContain('This draft changed while you were working on it.');
    await user.click(within(errors).getByRole('link'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('You have changes that are not saved.')).toBeTruthy();
  });

  it('is said in plain words when the service cannot be reached', async () => {
    const user = userEvent.setup();
    await openDraft({ [SAVE]: problem(503, 'The service is busy. Try again in a minute.') });
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), '!');

    await save(user);

    expect((await summary()).textContent).toContain('The service is busy. Try again in a minute.');
    expect(within(editor()).getByRole('textbox', { name: 'Question' })).toHaveProperty(
      'value',
      'Organisation name!',
    );
  });
});

describe('publishing a draft', () => {
  const publishedVersion = { ...published, id: ids.draft, version: 2 };

  it('asks first, saying that a published version cannot change and that new applications use it', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);

    await user.click(screen.getByRole('button', { name: 'Publish version 2' }));

    const dialog = await screen.findByRole('dialog', { name: 'Publish version 2?' });
    expect(dialog.textContent).toContain('A published version cannot be changed.');
    expect(dialog.textContent).toContain('New applications use version 2 from now on');
    expect(dialog.textContent).toContain('keep the version they were submitted on');
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(keys(sent)).not.toContain(api.publish(ids.draft));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish version 2' }));
  });

  it('saves the changes first, then publishes, and shows the published version', async () => {
    const user = userEvent.setup();
    const sent = await openDraft({
      ...saves,
      [api.publish(ids.draft)]: ok(publishedVersion),
    });
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), '!');

    await user.click(screen.getByRole('button', { name: 'Publish version 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish version 2?' });
    await user.click(within(dialog).getByRole('button', { name: 'Publish version 2' }));

    expect(
      await screen.findByText(/^Version 2, published 13 October 2026 at 10am by Ada Reed/),
    ).toBeTruthy();
    expect(keys(sent).filter((key) => key === SAVE || key === api.publish(ids.draft))).toEqual([
      SAVE,
      api.publish(ids.draft),
    ]);
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('Version 2 is published.')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
  });

  it('asks the server nothing more when a draft has problems, and shows them', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add section' }));

    await user.click(screen.getByRole('button', { name: 'Publish version 2' }));

    await summary();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(keys(sent)).not.toContain(SAVE);
    expect(keys(sent)).not.toContain(api.publish(ids.draft));
  });

  it('keeps the dialog open when the server refuses, with its words, then shows them beside the question', async () => {
    const user = userEvent.setup();
    const words = 'This version is already published.';
    await openDraft({
      [api.publish(ids.draft)]: problem(409, words),
    });
    await user.click(screen.getByRole('button', { name: 'Publish version 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish version 2?' });

    await user.click(within(dialog).getByRole('button', { name: 'Publish version 2' }));

    expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', words);
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect((await summary()).textContent).toContain(words);
  });
});

describe('discarding a draft', () => {
  it('asks first, then deletes it and goes back to the versions without asking about changes', async () => {
    const user = userEvent.setup();
    const sent = await openDraft({
      [api.discard(ids.draft)]: { status: 204 },
      [api.versions]: ok({ versions: [] }),
    });
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), '!');

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard this draft?' });
    expect(dialog.textContent).toContain('Published versions are not affected.');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep draft' }));
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'No form yet' })).toBeTruthy();
    expect(keys(sent)).toContain(api.discard(ids.draft));
    expect(window.location.pathname).toBe(`/northfield/rounds/${ids.round}/form`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("says why it could not, in the server's words, and keeps the draft", async () => {
    const user = userEvent.setup();
    await openDraft({
      [api.discard(ids.draft)]: problem(409, 'This version is published, so it cannot be changed.'),
    });

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }),
    );

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveProperty(
      'textContent',
      'This version is published, so it cannot be changed.',
    );
    expect(window.location.pathname).toContain(`/form/${ids.draft}`);
  });
});

describe('a draft that is empty', () => {
  it('says what to do, and starts with a section that has a question', async () => {
    const user = userEvent.setup();
    await openDraft({}, version(ids.draft, 1, 'draft', null));

    expect(screen.getByRole('heading', { level: 2, name: 'No sections yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import from file' })).toBeTruthy();
    expect(screen.getByText('Saved 14 October 2026 at 2:15pm.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add section' }));

    expect(screen.queryByRole('heading', { name: 'No sections yet' })).toBeNull();
    expect(within(editor('Edit section')).getByRole('textbox', { name: 'Title' })).toBeTruthy();
    expect(screen.getByText('You have changes that are not saved.')).toBeTruthy();
  });

  it('cannot be saved, or published, until it has a section', async () => {
    const user = userEvent.setup();
    const sent = await openDraft({}, version(ids.draft, 1, 'draft', null));

    await user.click(screen.getByRole('button', { name: 'Publish version 1' }));

    expect((await summary()).textContent).toContain('Add at least 1 item.');
    expect(keys(sent)).not.toContain(SAVE);
  });
});

describe('a form file', () => {
  const fileOf = (content: unknown) =>
    new File([typeof content === 'string' ? content : JSON.stringify(content)], 'form.json', {
      type: 'application/json',
    });
  const chosen = () => screen.getByLabelText('Form file to import');

  it('takes the place of the draft, which is then saved when the person says', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    expect(screen.getByText('Replaces everything in this draft.')).toBeTruthy();

    await user.upload(
      chosen(),
      fileOf({
        format: 'form-definition',
        formatVersion: 1,
        definition: {
          sections: [
            {
              id: 's_only',
              title: 'Everything',
              fields: [{ id: 'f_one', type: 'email', label: 'Contact email' }],
            },
          ],
        },
      }),
    );

    expect(await screen.findByText('Form imported. Save the draft to keep it.')).toBeTruthy();
    expect(sectionButton('Everything').getAttribute('aria-current')).toBe('true');
    expect(questionButton('Contact email').getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('button', { name: /^1\. About your organisation/ })).toBeNull();
    expect(screen.getByText('You have changes that are not saved.')).toBeTruthy();
    expect(keys(sent)).not.toContain(SAVE);
    await save(user);
    await screen.findByText(/^Saved 15 October/);
    expect(savedDefinition(sent).sections.map((section) => section.id)).toEqual(['s_only']);
  });

  it('is refused with each problem in it, and the draft is left as it was', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.upload(
      chosen(),
      fileOf({
        format: 'form-definition',
        formatVersion: 1,
        definition: {
          sections: [
            {
              id: 's_only',
              title: 'Everything',
              fields: [
                { id: 'f_one', type: 'email', label: 'Contact email' },
                { id: 'f_two', type: 'email', label: '' },
              ],
            },
          ],
        },
      }),
    );

    const errors = await screen.findByRole('alert', { name: 'We could not import this file' });
    expect(errors.textContent).toContain('Section 1, question 2: Enter at least 1 character.');
    await waitFor(() => {
      expect(document.activeElement).toBe(errors);
    });
    await user.click(within(errors).getByRole('link'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Import from file' }));
    expect(sectionButton('About your organisation')).toBeTruthy();
    expect(screen.queryByText('You have changes that are not saved.')).toBeNull();
  });

  it('is refused when it is not a form file, and a good one afterwards is taken', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.upload(chosen(), fileOf('this is not JSON'));
    expect(
      (await screen.findByRole('alert', { name: 'We could not import this file' })).textContent,
    ).toContain('This file is not a form. Choose a form file that was saved from this tool.');

    await user.upload(
      chosen(),
      fileOf({
        format: 'form-definition',
        formatVersion: 1,
        definition: organisationForm,
      }),
    );
    expect(await screen.findByText('Form imported. Save the draft to keep it.')).toBeTruthy();
    expect(screen.queryByRole('alert', { name: 'We could not import this file' })).toBeNull();
  });
});

describe('a published version', () => {
  it('is shown as applicants see it, with no way to change it, and a way back to the versions', async () => {
    const sent = stubApi(reads(draft, published));
    openConsole(`/northfield/rounds/${ids.round}/form/${ids.published}`);

    expect(
      await screen.findByText('Version 1, published 13 October 2026 at 10am by Ada Reed'),
    ).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText(/A published version cannot be changed/)).toBeTruthy();
    expect(screen.getByText('Section 1 of 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to versions' }).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/form`,
    );
    expect(keys(sent)).not.toContain(SAVE);
  });

  it('is a page that says it could not load, with a way to try again', async () => {
    const user = userEvent.setup();
    let busy = true;
    stubApi({
      ...reads(draft),
      [api.version(ids.draft)]: () =>
        busy ? problem(503, 'The service is busy. Try again in a minute.') : ok(draft),
    });
    openConsole(`/northfield/rounds/${ids.round}/form/${ids.draft}`);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    busy = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Sections' })).toBeTruthy();
  });

  it('is not for someone who cannot set up programmes', async () => {
    stubApi({ ...reads(draft), 'GET /auth/session': ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole(`/northfield/rounds/${ids.round}/form/${ids.draft}`);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
    ).toBeTruthy();
  });
});
