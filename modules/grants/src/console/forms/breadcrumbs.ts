// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BreadcrumbItem } from '@pixel-scientists/ui';

import type { Programme, Round } from '../../contracts/index.ts';
import { PROGRAMMES_PATH, programmePath, roundPath } from '../programme/paths.ts';
import { formPath } from './paths.ts';

/** From Programmes down to a round's form, then `after`, which comes last. */
export function formCrumbs(programme: Programme, round: Round, after?: string): BreadcrumbItem[] {
  return [
    { label: 'Programmes', to: PROGRAMMES_PATH },
    { label: programme.title, to: programmePath(programme.id) },
    { label: round.title, to: roundPath(round.id) },
    after === undefined ? { label: 'Form' } : { label: 'Form', to: formPath(round.id) },
    ...(after === undefined ? [] : [{ label: after }]),
  ];
}
