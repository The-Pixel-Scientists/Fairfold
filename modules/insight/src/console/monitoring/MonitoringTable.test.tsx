// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { monitoringReportSchema } from '../../contracts/index.ts';
import { MonitoringTable } from './MonitoringTable.tsx';

const ids = {
  runId: '44444444-4444-4444-8444-444444444444',
  reportId: '33333333-3333-4333-8333-333333333333',
};

const shown = (count: number) => ({ suppressed: false, count });
const hidden = { suppressed: true } as const;

/** 45 people: 30 said yes; the other 15 are split between two hidden answers. */
const report = monitoringReportSchema.parse({
  ...ids,
  reportVersion: 2,
  question: 'disability',
  breakdown: null,
  filter: null,
  disclosureRule: { version: 3, threshold: 10, minimumGroup: 20 },
  result: {
    status: 'shown',
    table: {
      columns: [],
      rows: [
        { option: 'yes', cells: [], total: shown(30) },
        { option: 'no', cells: [], total: hidden },
        { option: 'prefer_not_to_say', cells: [], total: hidden },
      ],
      totals: { cells: [], total: shown(45) },
    },
  },
});

describe('MonitoringTable', () => {
  it('names the report and the rule version in the caption, with scoped headers', () => {
    render(<MonitoringTable report={report} title="Disability monitoring" />);

    const table = screen.getByRole('table', {
      name: 'Disability monitoring: Disability, disclosure rule version 3',
    });
    expect(within(table).getByRole('columnheader', { name: 'Answer' }).getAttribute('scope')).toBe(
      'col',
    );
    expect(within(table).getByRole('rowheader', { name: 'Prefer not to say' })).toBeTruthy();
  });

  it('reads each hidden cell as "Fewer than 10", in text, with no number for it', () => {
    const { container } = render(<MonitoringTable report={report} title="Disability monitoring" />);

    const table = screen.getByRole('table');
    for (const name of ['No', 'Prefer not to say']) {
      const row = within(table).getByRole('rowheader', { name }).closest('tr');
      expect(row?.textContent).toBe(`${name}Fewer than 10`);
    }
    expect(within(table).getByRole('rowheader', { name: 'Yes' }).closest('tr')?.textContent).toBe(
      'Yes30',
    );
    // Only the three figures the response shows, and the threshold, appear as numbers.
    const numbers = container.textContent.match(/\d+/g);
    expect(new Set(numbers)).toEqual(new Set(['30', '45', '10', '3']));
    expect(container.querySelector('[title], [aria-label*="0"]')).toBeNull();
  });

  it('draws a bar only for a shown total, and hides the chart from assistive technology', () => {
    const { container } = render(<MonitoringTable report={report} title="Disability monitoring" />);

    const figure = container.querySelector('figure');
    expect(figure?.getAttribute('aria-hidden')).toBe('true');
    expect(figure?.querySelectorAll('svg')).toHaveLength(1);
    expect(figure?.querySelector('figcaption')?.textContent).toContain('version 3');
  });

  it('explains why cells are hidden, in words', () => {
    render(<MonitoringTable report={report} title="Disability monitoring" />);

    expect(
      screen.getByText(/To keep people anonymous, we do not show groups smaller than 10/),
    ).toBeTruthy();
  });

  it('says so when the whole table is withheld, and shows no table', () => {
    const withheld = monitoringReportSchema.parse({ ...report, result: { status: 'withheld' } });
    render(<MonitoringTable report={withheld} title="Disability monitoring" />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/Too few responses to show this report/)).toBeTruthy();
  });
});
