// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 6: the manager builds the round's form with three sections, an
// eligibility question that stops ineligible applicants, a conditional
// question, a word limit, contact answers hidden from reviewers, a budget table
// with a totalled cost column and a question asking for the latest accounts as
// a file. They preview it and publish version 1, which can no longer change.

import {
  buildForm,
  checkVersions,
  previewForm,
  publishVersionOne,
  saveDraft,
  startDraft,
} from '../../apps/console/e2e/form-builder-steps.ts';
import {
  addAccountsFile,
  addBudgetTable,
  previewBudget,
} from '../../apps/console/e2e/forms-builder-table-file-steps.ts';
import { axePages } from '../support/axe.ts';
import { consoleOrigin } from '../support/env.ts';
import { need, updateState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

interface Field {
  id: string;
  label: string;
  type: string;
  audiences: string[];
  identity: boolean;
}

test.describe('step 6: the manager builds and publishes the form', () => {
  test('builds three sections, previews the form as an applicant sees it and publishes version 1', async ({
    pages,
  }) => {
    const roundId = need('roundId');
    const page = await pages.staff('manager');
    await page.goto(`/northfield/rounds/${roundId}/form`);
    await startDraft(page);
    await buildForm(page);
    await addBudgetTable(page);
    await addAccountsFile(page);
    await saveDraft(page);
    await previewForm(page);
    await previewBudget(page);

    await page.reload();
    await expect(page.getByRole('button', { name: /^3\. Your budget/ })).toBeVisible();
    await publishVersionOne(page);
    await checkVersions(page);
  });

  test('the published version holds the questions with their audiences, and cannot be changed', async ({
    pages,
  }) => {
    const roundId = need('roundId');
    const page = await pages.staff('manager');
    const listed = (await (
      await page.request.get(`/api/console/rounds/${roundId}/form-versions`)
    ).json()) as { versions: { id: string; version: number; status: string }[] };
    const published = listed.versions.find(({ status }) => status === 'published');
    expect(published?.version).toBe(1);
    const formVersionId = published?.id ?? '';

    const version = (await (
      await page.request.get(`/api/console/form-versions/${formVersionId}`)
    ).json()) as { definition: { sections: { fields: Field[] }[] } };
    const fields = version.definition.sections.flatMap((section) => section.fields);
    const idOf = (label: RegExp): string =>
      fields.find((field) => label.test(field.label))?.id ?? '';
    const ids = {
      orgNameFieldId: idOf(/^Organisation name$/),
      charityFieldId: idOf(/registered charity\?$/),
      charityNumberFieldId: idOf(/^Registered charity number$/),
      emailFieldId: idOf(/^Contact email$/),
      projectFieldId: idOf(/^What will you do/),
      amountFieldId: idOf(/^How much are you asking for/),
      costsFieldId: idOf(/^What will it cost/),
      accountsFieldId: idOf(/^Latest accounts$/),
    };
    for (const [name, id] of Object.entries(ids)) expect(id, name).toMatch(/^f_[a-z0-9]+$/);
    const field = (id: string) => fields.find((candidate) => candidate.id === id);
    expect(field(ids.orgNameFieldId)?.audiences).not.toContain('reviewer');
    expect(field(ids.orgNameFieldId)?.identity).toBe(true);
    expect(field(ids.emailFieldId)?.audiences).not.toContain('reviewer');
    expect(field(ids.costsFieldId)?.type).toBe('table');
    expect(field(ids.accountsFieldId)?.type).toBe('file');

    // A published version cannot be discarded.
    const discarded = await page.request.delete(`/api/console/form-versions/${formVersionId}`, {
      headers: { origin: consoleOrigin },
    });
    expect(discarded.status()).toBe(409);

    updateState((state) => {
      state.ids['formVersionId'] = formVersionId;
      Object.assign(state.ids, ids);
    });
  });

  test('@a11y the form pages have no axe violations', async ({ pages }) => {
    const form = `/northfield/rounds/${need('roundId')}/form`;
    await axePages(await pages.staff('manager'), [form, `${form}/${need('formVersionId')}`]);
  });
});
