// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PreviewApp from './PreviewApp.tsx';
import { applyRoutes } from './routes.ts';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  delete document.documentElement.dataset.scheme;
  vi.restoreAllMocks();
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

  it('goes on to the outcomes when the budget is right', async () => {
    const user = userEvent.setup();
    await openBudget();

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Outcomes' }, loaded)).toBeTruthy();
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

  it('says the demo walks through the Riverside Lunch Club application from the start, and links to it', async () => {
    const user = userEvent.setup();
    open('/applications');
    await screen.findByRole('heading', { level: 1, name: 'Your applications' }, loaded);

    expect(screen.queryByRole('link', { name: /from the start/ })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Continue application for Riverside Pocket Garden' }),
    );

    expect(
      screen.getByText(
        'This demo walks through one application, Riverside Lunch Club, from the start.',
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'See the Riverside Lunch Club application from the start' })
        .getAttribute('href'),
    ).toBe('/dev/preview/round');
    expect(screen.queryByText(/opens in this demo/)).toBeNull();
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

  it('shows the saved organisation answers, and asks another question if it is not a charity', async () => {
    const user = userEvent.setup();
    open('/application/organisation');
    await screen.findByRole('heading', { level: 1, name: 'About your organisation' }, loaded);

    const value = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name).value;
    expect(value(/^Organisation name/)).toBe('Northfield Community Trust');
    expect(value(/^Registered charity number/)).toBe('1999876');
    expect(value(/^Address line 1/)).toBe('Riverside Hall');
    expect(value(/^Postcode/)).toBe('NF1 3QR');
    expect(value(/^Income last year/)).toBe('184200');
    expect(value(/^Paid staff and regular volunteers/)).toBe('44');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Led by women' }).checked).toBe(
      true,
    );

    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByLabelText(/^Registered charity number/)).toBeNull();
    expect(screen.getByRole('group', { name: /^Governing document/ })).toBeTruthy();
  });

  it('shows the saved project answers, with the words left in a long answer', async () => {
    open('/application/project');
    await screen.findByRole('heading', { level: 1, name: 'Your project' }, loaded);

    expect(screen.getAllByText('You have 32 words left').length).toBeGreaterThan(0);
    const start = within(screen.getByRole('group', { name: /^Start date/ }));
    expect(start.getByLabelText<HTMLInputElement>('Day').value).toBe('1');
    expect(start.getByLabelText<HTMLInputElement>('Month').value).toBe('6');
    expect(start.getByLabelText<HTMLInputElement>('Year').value).toBe('2027');
    for (const name of ['Northfield Central', 'Older people', 'Disabled people']) {
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name }).checked).toBe(true);
    }
  });

  it('shows the saved outcomes answers', async () => {
    open('/application/outcomes');
    await screen.findByRole('heading', { level: 1, name: 'Outcomes' }, loaded);

    expect(screen.getByLabelText<HTMLInputElement>(/^How many people will take part/).value).toBe(
      '120',
    );
    expect(screen.getByLabelText(/^How you will know/).textContent).toMatch(/loneliness scale/);
  });

  it('links each written section from the task list, and carries on in task list order', async () => {
    const user = userEvent.setup();
    open('/application');
    await screen.findByRole('heading', { level: 1, name: 'Your application' }, loaded);

    for (const [name, path] of [
      ['About your organisation', '/application/organisation'],
      ['Your project', '/application/project'],
      ['Outcomes', '/application/outcomes'],
    ]) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(`/dev/preview${path}`);
    }

    await user.click(screen.getByRole('link', { name: 'About your organisation' }));
    await screen.findByRole('heading', { level: 1, name: 'About your organisation' }, loaded);
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByRole('heading', { level: 1, name: 'Your project' }, loaded);
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Budget' }, loaded)).toBeTruthy();
  });

  it('goes back to the task list from a written section when you come back later', async () => {
    const user = userEvent.setup();
    open('/application/outcomes');
    await screen.findByRole('heading', { level: 1, name: 'Outcomes' }, loaded);

    await user.click(screen.getByRole('button', { name: 'Save and come back later' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your application' }, loaded),
    ).toBeTruthy();
  });

  it('opens every "Change" link at its own field and puts focus there', async () => {
    open('/application/check');
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' }, loaded);
    const hrefs = screen
      .getAllByRole('link', { name: /^Change / })
      .map((link) => link.getAttribute('href') ?? '');
    cleanup();

    expect(hrefs).toHaveLength(29);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/dev\/preview\/application\/[a-z]+#[a-z0-9-]+$/);
      window.history.replaceState(null, '', href);
      const { unmount } = render(<PreviewApp />);
      await waitFor(() => {
        expect(document.activeElement?.id).toBe(href.split('#')[1]);
      }, loaded);
      unmount();
    }
  }, 120_000);

  it('takes you to the question you chose to change, not to the top of the page', async () => {
    const user = userEvent.setup();
    open('/application/check');
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' }, loaded);

    await user.click(screen.getByRole('link', { name: 'Change main contact email' }));
    await screen.findByRole('heading', { level: 1, name: 'About your organisation' }, loaded);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/^Main contact email/));
    }, loaded);
  });

  it('reads the saved answers back on check your answers', async () => {
    open('/application/check');
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' }, loaded);

    for (const text of [
      'Northfield Community Trust',
      '1999876',
      '£184,200',
      '1 June 2027',
      '120',
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Led by women')).toBeTruthy();
    expect(screen.getByText('NF1 3QR')).toBeTruthy();
  });

  it('signs out to a calm page that says your work is safe and offers to sign in again', async () => {
    const user = userEvent.setup();
    open('/application');
    await screen.findByRole('heading', { level: 1, name: 'Your application' }, loaded);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You have signed out' }, loaded),
    ).toBeTruthy();
    expect(screen.getByText(/Your work is safe/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/dev/preview/',
    );
  });

  it('keeps the open draft, not the sent application, as the work saved on the signed-out page', async () => {
    open('/signed-out');
    await screen.findByRole('heading', { level: 1, name: 'You have signed out' }, loaded);

    expect(screen.getByText('Riverside Pocket Garden')).toBeTruthy();
    expect(screen.getByText('Green Spaces Fund, 2027')).toBeTruthy();
    expect(screen.getByText(/Last saved/).textContent).toBe('Last saved 20 February 2027');
    expect(screen.queryByText(/Riverside Lunch Club/)).toBeNull();
  });

  it.each(['/signed-out/', '/signed-out//'])(
    'shows no email or "Sign out" on %s, as a static host serves it with a trailing slash',
    async (path) => {
      open(path);
      await screen.findByRole('heading', { level: 1, name: 'You have signed out' }, loaded);

      expect(screen.queryByText('sam@example.org')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    },
  );

  it('still shows the email and "Sign out" on another page with a trailing slash', async () => {
    open('/applications/');
    await screen.findByRole('heading', { level: 1, name: 'Your applications' }, loaded);

    expect(screen.getByText('sam@example.org')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('opens the decision letter from the outcome, and prints it when asked', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    open('/outcome');
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Your application was successful' },
      loaded,
    );

    expect(screen.queryByText(/PDF, 96 KB/)).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Read or print your decision letter' }));
    await screen.findByRole('heading', { level: 1, name: 'Your decision letter' }, loaded);

    const letter = within(
      screen.getByRole('article', { name: 'Decision letter for Riverside Lunch Club' }),
    );
    expect(letter.getByText('Northfield Foundation')).toBeTruthy();
    expect(letter.getByText('Conditions of your grant')).toBeTruthy();
    expect(letter.getByText('What happens next')).toBeTruthy();
    expect(letter.getByText(/will give Northfield Community Trust £12,500/)).toBeTruthy();
    expect(screen.queryByText(/score|reviewer/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('prints the letter in the light scheme, then puts the person back in their own', async () => {
    open('/outcome/letter');
    await screen.findByRole('heading', { level: 1, name: 'Your decision letter' }, loaded);
    document.documentElement.dataset.scheme = 'dark';

    window.dispatchEvent(new Event('beforeprint'));
    expect(document.documentElement.dataset.scheme).toBe('light');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.dataset.scheme).toBe('dark');
  });
});
