// SPDX-License-Identifier: AGPL-3.0-or-later

import { monitoringTemplate } from '@pixel-scientists/grants/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { published, stored, summary as versionSummary, version } from '../forms/fixtures.ts';
import { APPLICATION, adjustment, assisted } from '../submissions/fixtures.ts';
import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { heading, ids, manager, ok, reads } from './fixtures.ts';

setUpConsoleTests();

const ROUND = `/northfield/rounds/${ids.round}`;
const ADJUSTMENTS = `GET /console/rounds/${ids.round}/adjustments`;
const DRAFTS = `GET /console/rounds/${ids.round}/assisted-applications`;
const START = `POST /console/rounds/${ids.round}/assisted-applications`;
const MONITORING = `GET /console/rounds/${ids.round}/monitoring-form`;
const CHOOSE_MONITORING = `PUT /console/rounds/${ids.round}/monitoring-form`;
const VERSIONS = `GET /console/rounds/${ids.round}/form-versions`;

const alternative = adjustment(2, {
  kind: 'alternative_route',
  closesAt: null,
  reasonCode: 'access_needs',
});

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await heading('Autumn 2026');
  await user.click(await screen.findByRole('tab', { name }));
}

describe("a round's adjustments", () => {
  const adjustReads = (extra = {}) => ({
    ...manager(),
    ...reads,
    [ADJUSTMENTS]: ok({ adjustments: [adjustment(1), alternative] }),
    [DRAFTS]: ok({ applications: [] }),
    ...extra,
  });

  it('lists each organisation with what it has, why and who gave it, and what to do when none', async () => {
    const user = userEvent.setup();
    stubApi(adjustReads());
    openConsole(ROUND);
    await openTab(user, 'More time and adjustments');

    const table = await screen.findByRole('table', { name: 'Adjustments in this round' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(
      'More time to apply until 9 November 2026 at 5pm, UK time',
    );
    expect(rows[0]?.textContent).toContain('Technical problem');
    expect(rows[0]?.textContent).toContain('Ada Reed');
    expect(await screen.findByText('Nothing in progress')).toBeTruthy();
  });

  it('gives an organisation more time after finding it, showing the round closing time beside the new one', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      adjustReads({
        'GET /console/organisations?search=Harbourside': ok({
          organisations: [
            {
              id: adjustment(1).organisation.id,
              name: 'Harbourside Youth Project',
              legalForm: 'other',
              identifiers: [],
            },
          ],
          nextCursor: null,
        }),
        [`POST /console/rounds/${ids.round}/adjustments`]: { status: 201, body: adjustment(3) },
      }),
    );
    openConsole(ROUND);
    await openTab(user, 'More time and adjustments');
    await user.click(await screen.findByRole('button', { name: 'Give more time' }));
    const find = await screen.findByRole('dialog', { name: 'Choose an organisation' });
    await user.type(within(find).getByLabelText('Organisation name or number'), 'Harbourside');
    await user.click(within(find).getByRole('button', { name: 'Search organisations' }));
    await user.click(
      await within(find).findByRole('button', { name: 'Harbourside Youth Project' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Give more time' });
    expect(within(dialog).getByText('It closes 2 November 2026 at 5pm, UK time now.')).toBeTruthy();
    const date = within(dialog).getByRole('group', { name: /New closing date/ });
    await user.type(within(date).getByRole('textbox', { name: 'Day' }), '9');
    await user.type(within(date).getByRole('textbox', { name: 'Month' }), '11');
    await user.type(within(date).getByRole('textbox', { name: 'Year' }), '2026');
    fireEvent.change(within(dialog).getByLabelText('New closing time'), {
      target: { value: '17:00' },
    });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'Caring responsibilities');
    await user.click(within(dialog).getByRole('button', { name: 'Give more time' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      sent.find(({ key }) => key.startsWith('POST') && key.endsWith('/adjustments'))?.body,
    ).toEqual({
      kind: 'deadline_extension',
      organisationId: adjustment(1).organisation.id,
      reasonCode: 'caring_responsibilities',
      closesAt: '2026-11-09T17:00',
    });
  });

  it('starts an application for an organisation with the alternative route, after step-up, and opens it', async () => {
    const user = userEvent.setup();
    let starts = 0;
    const sent = stubApi(
      adjustReads({
        [`GET /console/organisations/${alternative.organisation.id}`]: ok({
          id: alternative.organisation.id,
          name: alternative.organisation.name,
          legalForm: 'other',
          identifiers: [],
          registeredAddress: {
            line1: '1 High Street',
            line2: null,
            town: 'Leeds',
            postcode: 'LS1 1AA',
            countryCode: 'GB',
          },
          website: null,
          contacts: [
            {
              personId: assisted().contact.personId,
              givenName: 'Sam',
              familyName: 'Patel',
              email: 'sam@example.org',
            },
          ],
        }),
        [START]: () => {
          starts += 1;
          return starts === 1
            ? problem(403, 'Confirm it is you again, then try again.')
            : { status: 201, body: assisted() };
        },
        'POST /auth/step-up': ok(consoleSession()),
        [`GET /console/assisted-applications/${APPLICATION}`]: ok(assisted()),
      }),
    );
    openConsole(ROUND);
    await openTab(user, 'More time and adjustments');
    await user.click(await screen.findByRole('button', { name: /^Start application/ }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Start an application for an applicant',
    });
    await user.click(await within(dialog).findByRole('button', { name: /^Start application for/ }));
    expect(
      await within(dialog).findByText(
        'Choose a person who is a current contact for this organisation.',
      ),
    ).toBeTruthy();

    await user.selectOptions(within(dialog).getByLabelText('Who is applying?'), 'Sam Patel');
    await user.click(within(dialog).getByRole('button', { name: /^Start application for/ }));
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(step.getByLabelText('Password'), 'correct horse battery');
    await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(step.getByRole('button', { name: 'Confirm it is you' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/northfield/assisted-applications/${APPLICATION}`);
    });
    expect(sent.filter(({ key }) => key === START).map(({ body }) => body)[1]).toEqual({
      organisationId: alternative.organisation.id,
      contactPersonId: assisted().contact.personId,
    });
  });

  it('lists the applications in progress with a way back to each', async () => {
    const user = userEvent.setup();
    stubApi(
      adjustReads({
        [DRAFTS]: ok({
          applications: [
            {
              id: APPLICATION,
              organisation: assisted().organisation,
              contact: assisted().contact,
              updatedAt: '2026-10-30T09:00:00.000Z',
            },
          ],
        }),
      }),
    );
    openConsole(ROUND);
    await openTab(user, 'More time and adjustments');

    const link = await screen.findByRole('link', { name: /Continue/ });
    expect(link.getAttribute('href')).toBe(`/northfield/assisted-applications/${APPLICATION}`);
  });

  it('asks before removing one and says why it cannot be undone', async () => {
    const user = userEvent.setup();
    let removed = false;
    const sent = stubApi(
      adjustReads({
        [ADJUSTMENTS]: () =>
          ok({
            adjustments: [
              removed
                ? {
                    ...adjustment(1),
                    revoked: {
                      by: { membershipId: adjustment(1).grantedBy.membershipId, name: 'Ada Reed' },
                      at: '2026-11-02T09:00:00.000Z',
                      reasonCode: 'granted_in_error',
                    },
                  }
                : adjustment(1),
              alternative,
            ],
          }),
        [`POST /console/adjustments/${adjustment(1).id}/revoke`]: () => {
          removed = true;
          return ok(adjustment(1));
        },
      }),
    );
    openConsole(ROUND);
    await openTab(user, 'More time and adjustments');
    const [first] = await screen.findAllByRole('button', { name: /^Remove/ });
    await user.click(first as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Remove this adjustment?' });
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy();
    await user.selectOptions(
      within(dialog).getByLabelText('Why are you removing it?'),
      'Given by mistake',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove adjustment' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key.endsWith('/revoke'))?.body).toEqual({
        reasonCode: 'granted_in_error',
      });
    });
    // The Remove button that opened the dialog is replaced by a tag, so focus goes to the notice.
    const notice = await screen.findByText('Adjustment removed for Harbourside Youth Project.');
    await waitFor(() => {
      expect(document.activeElement).toBe(notice);
    });
  });
});

describe("a round's equality monitoring form", () => {
  const monitoring = stored(monitoringTemplate());
  const monitoringVersion = {
    ...version('00000000-0000-4000-8000-000000000333', 3, 'published', monitoring),
  };
  const choiceReads = (extra = {}) => ({
    ...manager(),
    ...reads,
    [MONITORING]: ok({ formVersionId: null }),
    [VERSIONS]: ok({ versions: [versionSummary(monitoringVersion), versionSummary(published)] }),
    [`GET /console/form-versions/${monitoringVersion.id}`]: ok(monitoringVersion),
    [`GET /console/form-versions/${published.id}`]: ok(published),
    ...extra,
  });

  it('says staff never see answers, and offers only versions that pass the monitoring check', async () => {
    const user = userEvent.setup();
    stubApi(choiceReads());
    openConsole(ROUND);
    await openTab(user, 'Equality monitoring');

    expect(
      await screen.findByText(
        'Staff and reviewers never see individual answers. Reports show only totals.',
      ),
    ).toBeTruthy();
    const select = await screen.findByLabelText('Equality monitoring form');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['No equality monitoring form', expect.stringMatching(/^Version 3, published/)]);
  });

  it('saves the choice and says so', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      choiceReads({ [CHOOSE_MONITORING]: ok({ formVersionId: monitoringVersion.id }) }),
    );
    openConsole(ROUND);
    await openTab(user, 'Equality monitoring');
    await user.selectOptions(
      await screen.findByLabelText('Equality monitoring form'),
      monitoringVersion.id,
    );
    await user.click(screen.getByRole('button', { name: 'Save equality monitoring form' }));

    expect(await screen.findByText('Equality monitoring form saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === CHOOSE_MONITORING)?.body).toEqual({
      formVersionId: monitoringVersion.id,
    });
  });

  it('says what to publish when no version can be chosen yet', async () => {
    const user = userEvent.setup();
    stubApi(choiceReads({ [VERSIONS]: ok({ versions: [versionSummary(published)] }) }));
    openConsole(ROUND);
    await openTab(user, 'Equality monitoring');
    expect(await screen.findByText('No equality monitoring form to choose')).toBeTruthy();
  });
});
