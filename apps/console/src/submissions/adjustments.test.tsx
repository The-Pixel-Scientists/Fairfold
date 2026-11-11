// SPDX-License-Identifier: AGPL-3.0-or-later

import { sessionSchema } from '@pixel-scientists/domain/auth';
import { monitoringTemplate } from '@pixel-scientists/grants/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stored } from '../forms/fixtures.ts';
import { SESSION } from '../programme/fixtures.ts';
import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import {
  adjustment,
  adjustmentsFor,
  api,
  detail,
  heading,
  manager,
  ok,
  page,
  programmes,
  stages,
  summary,
  uuid,
} from './fixtures.ts';

setUpConsoleTests();

const one = detail();
const PATH = `/northfield/submissions/${one.id}`;

const reads = (adjustments = adjustmentsFor([adjustment(1)]), extra = {}) => ({
  ...manager(),
  [api.programmes]: ok(programmes),
  [api.stages]: ok({ stages }),
  [api.one(one.id)]: ok(one),
  [api.files(one.id)]: ok({ attachments: [] }),
  [api.assignments(one.id)]: ok({ assignments: [] }),
  [api.list()]: ok(page([summary(1)])),
  [api.adjustments(one.id)]: ok(adjustments),
  ...extra,
});

/** The panel once it has loaded. */
async function panel() {
  const section = await screen.findByRole('region', { name: 'More time and adjustments' });
  await within(section).findByText(/^Closes /);
  return section;
}

async function fill(user: ReturnType<typeof userEvent.setup>, reason = 'Technical problem') {
  const date = screen.getByRole('group', { name: /New closing date/ });
  await user.type(within(date).getByRole('textbox', { name: 'Day' }), '9');
  await user.type(within(date).getByRole('textbox', { name: 'Month' }), '11');
  await user.type(within(date).getByRole('textbox', { name: 'Year' }), '2026');
  fireEvent.change(screen.getByLabelText('New closing time'), { target: { value: '17:01' } });
  await user.selectOptions(screen.getByLabelText('Reason'), reason);
}

describe("a submission's adjustments", () => {
  it('lists each with what it gives, why, who gave it and when, and when the submission closes', async () => {
    stubApi(reads(adjustmentsFor([adjustment(1)], '2026-11-09T17:00')));
    openConsole(PATH);

    const section = await panel();
    expect(within(section).getByText('Closes 9 November 2026 at 5pm, UK time.')).toBeTruthy();
    expect(section.textContent).toContain(
      'More time to apply until 9 November 2026 at 5pm, UK time',
    );
    expect(within(section).getByText(/Technical problem\. Ada Reed, 1 November 2026/)).toBeTruthy();
  });

  it('says what to do when there are none', async () => {
    stubApi(reads(adjustmentsFor([])));
    openConsole(PATH);
    expect(await within(await panel()).findByText(/No adjustments\. Give more time/)).toBeTruthy();
  });

  it('is left out for a member without the permission, and nothing is read for it', async () => {
    const session = consoleSession();
    const without = sessionSchema.parse({
      ...session,
      permissions: session.permissions.filter((item) => item !== 'grants.adjustments.manage'),
    });
    const sent = stubApi({ ...reads(), [SESSION]: ok(without) });
    openConsole(PATH);
    await heading('Harbourside Youth Project');
    await screen.findByRole('list', { name: 'Stages' });
    expect(screen.queryByRole('region', { name: 'More time and adjustments' })).toBeNull();
    expect(sent.some(({ key }) => key === api.adjustments(one.id))).toBe(false);
  });

  it('asks for the closing time and a reason before it sends anything', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads());
    openConsole(PATH);
    await user.click(await within(await panel()).findByRole('button', { name: 'Give more time' }));

    const dialog = await screen.findByRole('dialog', { name: 'Give more time' });
    await user.click(within(dialog).getByRole('button', { name: 'Give more time' }));
    expect(screen.getAllByText('Enter the new closing date and time.')).not.toHaveLength(0);
    expect(screen.getByText('Choose a reason for the adjustment.')).toBeTruthy();
    expect(sent.some(({ key }) => key === api.give)).toBe(false);
  });

  it('sends the closing time as typed in the zone, the reason code and no person, once for a double click', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const sent = stubApi(
      reads(undefined, {
        [api.give]: () => {
          calls += 1;
          return { status: 201, body: adjustment(2) };
        },
      }),
    );
    openConsole(PATH);
    await user.click(await within(await panel()).findByRole('button', { name: 'Give more time' }));
    const dialog = await screen.findByRole('dialog', { name: 'Give more time' });
    expect(within(dialog).getByText('UK time')).toBeTruthy();
    expect(within(dialog).getByText(/The applicant sees only their new closing time/)).toBeTruthy();
    await fill(user);

    const submit = within(dialog).getByRole('button', { name: 'Give more time' });
    await user.dblClick(submit);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls).toBe(1);
    const [request] = sent.filter(({ key }) => key === api.give);
    expect(request?.body).toEqual({
      kind: 'deadline_extension',
      organisationId: one.organisation.id,
      applicationId: one.id,
      reasonCode: 'technical_problem',
      closesAt: '2026-11-09T17:01',
    });
    // The reason is never in the address or the page title.
    expect(window.location.href).not.toMatch(/technical|reason/i);
    expect(document.title).not.toMatch(/technical|reason/i);
  });

  it("shows the server's refusal of a closing time beside it, and keeps what was typed", async () => {
    const user = userEvent.setup();
    stubApi(
      reads(undefined, {
        [api.give]: problem(400, 'Check the highlighted fields.', [
          {
            field: 'body.closesAt',
            message: "Enter a new closing date and time after the round's own closing time.",
          },
        ]),
      }),
    );
    openConsole(PATH);
    await user.click(await within(await panel()).findByRole('button', { name: 'Give more time' }));
    const dialog = await screen.findByRole('dialog', { name: 'Give more time' });
    await fill(user);
    await user.click(within(dialog).getByRole('button', { name: 'Give more time' }));

    expect(await within(dialog).findByText(/after the round's own closing time/)).toBeTruthy();
    expect(within(dialog).getByLabelText('New closing time')).toHaveProperty('value', '17:01');
  });

  it('gives the alternative route with a reason and no closing time', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(undefined, {
        [api.give]: {
          status: 201,
          body: adjustment(3, { kind: 'alternative_route', closesAt: null }),
        },
      }),
    );
    openConsole(PATH);
    await user.click(
      await within(await panel()).findByRole('button', { name: 'Let staff submit for them' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Let staff submit for the applicant',
    });
    expect(within(dialog).queryByLabelText('New closing time')).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'Access needs');
    await user.click(within(dialog).getByRole('button', { name: 'Allow staff to submit' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key === api.give)?.body).toEqual({
        kind: 'alternative_route',
        organisationId: one.organisation.id,
        reasonCode: 'access_needs',
      });
    });
  });

  it('asks before removing one, with a reason, and reads the list again', async () => {
    const user = userEvent.setup();
    const first = adjustment(1);
    let removed = false;
    const sent = stubApi(
      reads(undefined, {
        [api.adjustments(one.id)]: () =>
          ok(
            adjustmentsFor([
              removed
                ? {
                    ...first,
                    revoked: {
                      by: { membershipId: uuid(11), name: 'Ada Reed' },
                      at: '2026-11-02T09:00:00.000Z',
                      reasonCode: 'applicant_asked',
                    },
                  }
                : first,
            ]),
          ),
        [api.revoke(first.id)]: () => {
          removed = true;
          return ok(first);
        },
      }),
    );
    openConsole(PATH);
    await user.click(await within(await panel()).findByRole('button', { name: /^Remove/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove this adjustment?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove adjustment' }));
    expect(within(dialog).getByText('Choose why you are removing the adjustment.')).toBeTruthy();

    await user.selectOptions(
      within(dialog).getByLabelText('Why are you removing it?'),
      'The applicant asked',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove adjustment' }));

    expect(await within(await panel()).findByText('Removed')).toBeTruthy();
    // The Remove button that opened the dialog is gone, so focus goes to the notice.
    const notice = screen.getByText('Adjustment removed for Harbourside Youth Project.');
    await waitFor(() => {
      expect(document.activeElement).toBe(notice);
    });
    expect(sent.find(({ key }) => key === api.revoke(first.id))?.body).toEqual({
      reasonCode: 'applicant_asked',
    });
  });
});

describe('what the submission shows of monitoring', () => {
  it('renders no monitoring question, even if the form has one', async () => {
    const withMonitoring = detail({
      form: {
        ...one.form,
        definition: stored({
          sections: [...one.form.definition.sections, ...monitoringTemplate().sections],
        }),
      },
    });
    stubApi({
      ...reads(),
      [api.one(withMonitoring.id)]: ok(withMonitoring),
    });
    openConsole(PATH);
    await heading('Harbourside Youth Project');
    await screen.findByRole('region', { name: 'More time and adjustments' });
    expect(screen.queryByText(/ethnic group/i)).toBeNull();
    expect(screen.queryByText(/monitoring/i)).toBeNull();
  });
});
