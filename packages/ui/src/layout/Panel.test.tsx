// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../Button.tsx';
import { Panel } from './Panel.tsx';

describe('Panel', () => {
  it('is a section named by its title', () => {
    render(
      <Panel title="Activity">
        <p>Application submitted</p>
      </Panel>,
    );

    const region = screen.getByRole('region', { name: 'Activity' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Activity' })).toBeTruthy();
    expect(within(region).getByText('Application submitted')).toBeTruthy();
  });

  it('takes the heading level the page needs', () => {
    render(
      <Panel title="Activity" headingLevel="h3">
        <p>Nothing yet</p>
      </Panel>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Activity' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('is not a landmark without a title', () => {
    render(
      <Panel>
        <p>Nothing yet</p>
      </Panel>,
    );

    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('puts the actions in the title row', () => {
    render(
      <Panel title="Activity" actions={<Button variant="quiet">Add note</Button>}>
        <p>Nothing yet</p>
      </Panel>,
    );

    const heading = screen.getByRole('heading', { name: 'Activity' });
    expect(heading.parentElement?.contains(screen.getByRole('button', { name: 'Add note' }))).toBe(
      true,
    );
  });

  it('shows actions even when it has no title', () => {
    render(
      <Panel actions={<Button>Add note</Button>}>
        <p>Nothing yet</p>
      </Panel>,
    );

    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
  });

  it('draws its edge with the border, and takes extra classes', () => {
    render(
      <Panel title="Activity" className="lg:col-span-2">
        <p>Nothing yet</p>
      </Panel>,
    );

    const classes = screen.getByRole('region').className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['border', 'border-divider', 'rounded-lg']));
    expect(classes).toContain('lg:col-span-2');
  });
});
