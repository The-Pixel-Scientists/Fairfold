// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SnapshotPanel } from '../../../../modules/grants/src/console/submissions/detail/SnapshotPanel.tsx';
import type { SnapshotPanelProps } from '../../../../modules/grants/src/console/submissions/detail/SnapshotPanel.tsx';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const snapshot: NonNullable<SnapshotPanelProps['snapshot']> = {
  id: uuid(800),
  organisationId: uuid(201),
  name: 'Riverside Youth Trust',
  legalForm: 'registered_charity',
  registeredAddress: {
    line1: '1 High Street',
    line2: null,
    town: 'Leeds',
    postcode: 'LS1 1AA',
    countryCode: 'GB',
  },
  website: 'https://riverside.example',
  identifiers: [
    { scheme: 'GB-CHC', identifier: '1234567', verifiedAt: '2026-09-01T10:00:00.000Z' },
    { scheme: 'GB-COH', identifier: '01234567', verifiedAt: null },
  ],
  takenBy: uuid(11),
  takenAt: '2026-10-30T14:30:00.000Z',
};

describe('organisation details as submitted', () => {
  it('shows the details with each identifier as it was verified, and when they were taken', () => {
    render(<SnapshotPanel snapshot={snapshot} current={snapshot} timeZone="Europe/London" />);

    const panel = screen.getByRole('region', { name: 'Organisation details as submitted' });
    expect(within(panel).getByText('Riverside Youth Trust')).toBeTruthy();
    expect(within(panel).getByText('Registered charity')).toBeTruthy();
    expect(within(panel).getByText('1 High Street, Leeds, LS1 1AA')).toBeTruthy();
    expect(within(panel).getByText('Verified 1 September 2026 at 11am')).toBeTruthy();
    expect(within(panel).getByText('Not verified')).toBeTruthy();
    expect(within(panel).getByText('30 October 2026 at 2:30pm')).toBeTruthy();
    expect(within(panel).queryByRole('status')?.textContent).toBe('');
  });

  it('says what has changed since, without merging the two', () => {
    render(
      <SnapshotPanel
        snapshot={snapshot}
        current={{ ...snapshot, name: 'Riverside Youth Trust CIO', website: null }}
        timeZone="Europe/London"
      />,
    );

    expect(
      screen.getByText(
        "The organisation's name and website have changed since this was submitted.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Riverside Youth Trust')).toBeTruthy();
    expect(screen.queryByText('Riverside Youth Trust CIO')).toBeNull();
  });

  it('says plainly that no snapshot was taken, as a message and not an error', () => {
    render(<SnapshotPanel snapshot={null} />);

    expect(
      screen.getByText('Details as submitted were not recorded for this submission.'),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
