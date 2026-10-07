// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tabs } from './Tabs.tsx';
import type { TabsProps } from './Tabs.tsx';

const tabs: TabsProps['tabs'] = [
  { id: 'answers', label: 'Answers', content: <p>The applicant's answers</p> },
  { id: 'reviews', label: 'Reviews', content: <p>Two reviews submitted</p> },
  { id: 'notes', label: 'Notes', content: <button type="button">Add note</button> },
  { id: 'history', label: 'History', content: <p>Application submitted</p> },
];

const tab = (name: string) => screen.getByRole('tab', { name });

function Example(props: Partial<TabsProps>) {
  return <Tabs label="Application sections" tabs={tabs} {...props} />;
}

describe('Tabs', () => {
  it('is a tab list named by its label, with the first tab selected and its panel shown', () => {
    render(<Example />);

    expect(screen.getByRole('tablist', { name: 'Application sections' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((item) => item.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Answers' }).textContent).toBe(
      "The applicant's answers",
    );
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('opens the tab named by defaultTab', () => {
    render(<Example defaultTab="notes" />);

    expect(tab('Notes').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Notes' })).toBeTruthy();
  });

  it('opens a tab when it is clicked', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(tab('Reviews'));
    expect(tab('Reviews').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Reviews' }).textContent).toBe(
      'Two reviews submitted',
    );
  });

  it('is one tab stop on the selected tab, and the arrow keys move and open as they go', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();
    expect(document.activeElement).toBe(tab('Answers'));
    expect(screen.getAllByRole('tab').map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Reviews'));
    expect(tab('Reviews').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Reviews' })).toBeTruthy();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(tab('History'));
    expect(tab('History').getAttribute('aria-selected')).toBe('true');
  });

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();
    await user.keyboard('{End}');
    expect(tab('History').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}');
    expect(tab('Answers').getAttribute('aria-selected')).toBe('true');
  });

  it('moves from the tabs into the open panel with Tab', async () => {
    const user = userEvent.setup();
    render(<Example defaultTab="notes" />);

    await user.tab();
    expect(document.activeElement).toBe(tab('Notes'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tabpanel', { name: 'Notes' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add note' }));
  });
});
