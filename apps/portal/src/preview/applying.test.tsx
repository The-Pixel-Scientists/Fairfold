// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import PreviewApp from './PreviewApp.tsx';
import { applyRoutes } from './routes.ts';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

/** A route's page loads on demand, which can take longer than the default wait on a busy machine. */
const loaded = { timeout: 10_000 };

function open(path: string) {
  window.history.replaceState(null, '', `/dev/preview${path}`);
  return render(<PreviewApp />);
}

async function openBudget() {
  open('/application/budget');
  await screen.findByRole('heading', { level: 1, name: 'Budget' }, loaded);
  return within(screen.getByRole('region', { name: 'Amount you are asking for' }));
}

describe('the applying previews', () => {
  it.each(applyRoutes.map(({ path }) => path))(
    'show %s with one h1 and a mark that it is a preview',
    async (path) => {
      open(path);

      expect(await screen.findByRole('heading', { level: 1 }, loaded)).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByText('Design preview')).toBeTruthy();
    },
  );

  it('works out the amount asked for from the costs and other funding, and keeps it in step', async () => {
    const user = userEvent.setup();
    const panel = await openBudget();

    expect(screen.getByText('£13,500', { selector: 'p span' })).toBeTruthy();
    expect(panel.getByText('£12,500')).toBeTruthy();

    await user.clear(screen.getByLabelText('Cost for line 1'));
    await user.type(screen.getByLabelText('Cost for line 1'), '30000');

    expect(panel.getByText('£39,620')).toBeTruthy();
    expect(panel.getByText(/This fund gives £1,000 to £25,000/)).toBeTruthy();
  });

  it('works out nothing while an amount is not a number, rather than count it as nothing', async () => {
    const user = userEvent.setup();
    const panel = await openBudget();

    const amount = screen.getByLabelText('Cost for line 2');
    await user.clear(amount);
    await user.type(amount, '4,8oo');
    await user.tab();

    expect(screen.getByText('Not worked out yet')).toBeTruthy();
    expect(screen.queryByText('£13,500')).toBeNull();
    expect(screen.getByText('Enter the cost in pounds, like 2,880')).toBeTruthy();
    expect(panel.getByText(/We cannot work this out until every amount is a number/)).toBeTruthy();
    expect(panel.getByText(/Check the amounts that have an error message\./)).toBeTruthy();
    expect(panel.getByText(/^We cannot work out the amount you are asking for/)).toBeTruthy();
    expect(panel.queryByText(/£/)).toBeNull();
  });

  it('tells a screen reader the new amount when a box is left, not on every key', async () => {
    const user = userEvent.setup();
    const panel = await openBudget();

    await user.clear(screen.getByLabelText('Cost for line 1'));
    await user.type(screen.getByLabelText('Cost for line 1'), '30000');
    expect(panel.getByText(/^You are asking for £12,500/)).toBeTruthy();

    await user.tab();
    expect(panel.getByText(/^You are asking for £39,620. This is outside the range/)).toBeTruthy();
  });

  it('stays on the budget and lists what to fix when an amount is wrong', async () => {
    const user = userEvent.setup();
    await openBudget();

    const amount = screen.getByLabelText('Cost for line 2');
    await user.clear(amount);
    await user.type(amount, '4,8oo');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(
      within(screen.getByRole('alert')).getByRole('link', {
        name: 'Enter the cost for line 2 in pounds, like 2,880',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeTruthy();
  });

  it('stays on the budget when the amount asked for is outside the fund range, and links to it', async () => {
    const user = userEvent.setup();
    await openBudget();

    await user.clear(screen.getByLabelText('Cost for line 1'));
    await user.type(screen.getByLabelText('Cost for line 1'), '30000');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await user.click(
      within(screen.getByRole('alert')).getByRole('link', {
        name: 'The amount you ask for must be between £1,000 and £25,000',
      }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Amount you are asking for' }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeTruthy();
  });

  it('goes on to the documents when the budget is right', async () => {
    const user = userEvent.setup();
    await openBudget();

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Documents' }, loaded),
    ).toBeTruthy();
  });

  it('adds a cost and puts focus in it, and removes one', async () => {
    const user = userEvent.setup();
    await openBudget();

    await user.click(screen.getByRole('button', { name: 'Add a cost' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Item for line 7'));

    await user.click(screen.getByRole('button', { name: 'Remove line 7' }));
    expect(screen.queryByLabelText('Item for line 7')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Item for line 6'));
  });

  it('takes other funding off the amount asked for, and adds and removes funding lines', async () => {
    const user = userEvent.setup();
    const panel = await openBudget();
    const total = () => screen.getByText('Total other funding').nextElementSibling?.textContent;

    expect(total()).toBe('£1,000');

    await user.click(screen.getByRole('button', { name: 'Add other funding' }));
    expect(document.activeElement).toBe(
      screen.getByLabelText('Where the money comes from for other funding 2'),
    );
    await user.type(screen.getByLabelText('Amount for other funding 2'), '500');
    await user.tab();
    expect(total()).toBe('£1,500');
    expect(panel.getByText('£12,000')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove other funding 1' }));
    expect(total()).toBe('£500');
    expect(document.activeElement).toBe(
      screen.getByLabelText('Where the money comes from for other funding 1'),
    );
    expect(panel.getByText('£13,000')).toBeTruthy();
  });

  it('says what to fix when the other funding is not an amount', async () => {
    const user = userEvent.setup();
    await openBudget();

    const amount = screen.getByLabelText('Amount for other funding 1');
    await user.clear(amount);
    await user.type(amount, 'a thousand');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(
      within(screen.getByRole('alert')).getByRole('link', {
        name: 'Enter the amount for other funding 1 in pounds, like 1,000',
      }),
    ).toBeTruthy();
  });

  it('asks for every declaration before it sends the application', async () => {
    const user = userEvent.setup();
    open('/application/check');
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' }, loaded);

    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(
      within(screen.getByRole('alert')).getByRole('link', {
        name: 'Tick every box to confirm your declarations',
      }),
    ).toBeTruthy();

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const name of [
      'Our governing body has agreed to this application.',
      'Our safeguarding policy was reviewed in the last 12 months.',
      'The answers in this application are true, and I am allowed to apply for my organisation.',
    ]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Application submitted' }, loaded),
    ).toBeTruthy();
  });

  it('shows the costs as a list that ends in the total, not as a table', async () => {
    open('/application/check');
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' }, loaded);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Cook').parentElement?.textContent).toBe('Cook£2,400');
    expect(screen.getByText('Total cost of the project').parentElement?.textContent).toBe(
      'Total cost of the project£13,500',
    );
  });

  it('shows an applicant only that an application is submitted, not where it has got to', async () => {
    open('/applications');
    await screen.findByRole('heading', { level: 1, name: 'Your applications' }, loaded);

    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.queryByText(/shortlisted|in review|score/i)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'See what happens next for Riverside Lunch Club' }),
    ).toBeTruthy();
    expect(screen.getByText('Winter Warm Space')).toBeTruthy();
    expect(screen.getByText('16 November 2026')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Continue application for Riverside Pocket Garden' }),
    ).toBeTruthy();
  });

  it('says only the Riverside Lunch Club application opens in the demo, and links to it', async () => {
    const user = userEvent.setup();
    open('/applications');
    await screen.findByRole('heading', { level: 1, name: 'Your applications' }, loaded);

    expect(
      screen.queryByRole('link', { name: /Open the Riverside Lunch Club application/ }),
    ).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Continue application for Riverside Pocket Garden' }),
    );

    expect(
      screen.getByText(/Only the Riverside Lunch Club application opens in this demo/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Open the Riverside Lunch Club application' })
        .getAttribute('href'),
    ).toBe('/dev/preview/application');
  });

  it('asks the applicant to accept the grant conditions, then confirms it', async () => {
    const user = userEvent.setup();
    open('/outcome');
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Your application was successful' },
      loaded,
    );

    expect(screen.queryByText(/score|reviewer/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept the conditions' }));

    expect(document.activeElement?.textContent).toMatch(/You have accepted these conditions/);
    expect(screen.queryByRole('button', { name: 'Accept the conditions' })).toBeNull();
  });
});
