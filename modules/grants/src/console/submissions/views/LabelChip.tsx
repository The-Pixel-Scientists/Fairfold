// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tag } from '@pixel-scientists/ui';

import type { Label, LabelColour } from '../../../contracts/index.ts';

/** The words for a label's colour, so a person never has to pick by sight. */
export const colourWords: Record<LabelColour, string> = {
  neutral: 'Grey',
  info: 'Blue',
  success: 'Green',
  warning: 'Amber',
  danger: 'Red',
};

/** A label by its name. The colour only decorates; an archived label says so. */
export function LabelChip({ label }: { label: Pick<Label, 'name' | 'colour' | 'archived'> }) {
  return (
    <Tag tone={label.colour ?? 'neutral'}>
      {label.name}
      {label.archived && ' (archived)'}
    </Tag>
  );
}
