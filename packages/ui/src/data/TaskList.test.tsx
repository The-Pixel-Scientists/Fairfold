// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderRouter, setUpRouterTests } from '../../test/routerTesting.tsx';
import { Router } from '../router/index.ts';
import { TaskList } from './TaskList.tsx';
import type { TaskListProps } from './TaskList.tsx';

setUpRouterTests();

const items: TaskListProps['items'] = [
  { label: 'About your organisation', to: '/organisation', status: 'completed' },
  {
    label: 'Your project',
    to: '/project',
    status: 'in-progress',
    hint: 'Describe who will benefit.',
  },
  { label: 'Budget', to: '/budget', status: 'not-started' },
  { label: 'Declarations', status: 'cannot-start', hint: 'Complete every other section first.' },
];

/** The links are router links, so the list renders inside a Router. */
function renderList() {
  renderRouter(
    '/',
    <Router
      routes={[
        {
          path: '/',
          title: 'Application',
          component: () => <TaskList label="Application sections" items={items} />,
        },
      ]}
    />,
  );
}

/** What assistive technology reads as the description of an element. */
function description(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
}

describe('TaskList', () => {
  it('is a list named by its label, with one item for each section', () => {
    renderList();

    const list = screen.getByRole('list', { name: 'Application sections' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  });

  it('links each section that has a path, to that path', () => {
    renderList();

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/organisation',
      '/project',
      '/budget',
    ]);
  });

  it('shows a section with no path as text, not a link', () => {
    renderList();

    expect(screen.queryByRole('link', { name: 'Declarations' })).toBeNull();
    expect(screen.getByText('Declarations')).toBeTruthy();
  });

  it('says each status in words', () => {
    renderList();

    const statuses = screen
      .getAllByRole('listitem')
      .map(
        (item) => /Completed|In progress|Not started|Cannot start yet/.exec(item.textContent)?.[0],
      );
    expect(statuses).toEqual(['Completed', 'In progress', 'Not started', 'Cannot start yet']);
  });

  it('describes a link by its status, and its hint when it has one, without adding them to its name', () => {
    renderList();

    const budget = screen.getByRole('link', { name: 'Budget' });
    expect(description(budget)).toBe('Not started');
    expect(description(screen.getByRole('link', { name: 'Your project' }))).toBe(
      'In progress Describe who will benefit.',
    );
  });

  it('shows the hint under its section', () => {
    renderList();

    expect(screen.getByText('Complete every other section first.')).toBeTruthy();
  });
});
