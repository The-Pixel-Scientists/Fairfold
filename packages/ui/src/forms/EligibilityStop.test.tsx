// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EligibilityStop } from './EligibilityStop.tsx';

describe('EligibilityStop', () => {
  it('is an announced notice that names why, and what the person can do next', () => {
    render(
      <EligibilityStop
        fieldId="f_charity"
        explanation="This fund is open to registered charities only."
      />,
    );

    const notice = screen.getByRole('alert', { name: 'You cannot apply with this answer' });
    expect(notice.textContent).toContain('This fund is open to registered charities only.');
    expect(notice.textContent).toContain('If your answer is wrong, change it and carry on.');
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('moves focus to the question when the person chooses to change their answer', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input id="f_charity" aria-label="Charity" />
        <EligibilityStop fieldId="f_charity" explanation="Charities only." headingLevel="h3" />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Change your answer' }));

    expect(document.activeElement).toBe(screen.getByLabelText('Charity'));
    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
  });

  it('does nothing when the question is no longer on the page', async () => {
    const user = userEvent.setup();
    render(<EligibilityStop fieldId="f_gone" explanation="Charities only." />);

    await user.click(screen.getByRole('button', { name: 'Change your answer' }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change your answer' }));
  });
});
