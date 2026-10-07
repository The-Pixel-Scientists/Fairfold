// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SectionProgress } from './SectionProgress.tsx';

describe('SectionProgress', () => {
  it('says which section the person is on, in words', () => {
    render(<SectionProgress current={2} total={5} />);

    expect(screen.getByText('Section 2 of 5')).toBeTruthy();
  });

  it('reads the title after the count, with the dot between them hidden from assistive technology', () => {
    const { container } = render(<SectionProgress current={3} total={6} title="Budget" />);

    const text = container.querySelector('p');
    expect(text?.textContent.replace(/\s+/g, ' ')).toBe('Section 3 of 6: · Budget');
    expect(text?.querySelector('[aria-hidden="true"]')?.textContent.trim()).toBe('·');
  });

  it('leaves out the title when there is none', () => {
    const { container } = render(<SectionProgress current={1} total={4} />);

    expect(container.querySelector('p')?.textContent).toBe('Section 1 of 4');
  });

  it('hides the bar from assistive technology, with one segment for each section', () => {
    const { container } = render(<SectionProgress current={3} total={6} />);

    const bar = container.querySelector('[aria-hidden="true"]');
    expect(bar?.children).toHaveLength(6);
    expect(
      [...(bar?.children ?? [])].map((segment) => segment.className.includes('bg-accent')),
    ).toEqual([true, true, true, false, false, false]);
  });
});
