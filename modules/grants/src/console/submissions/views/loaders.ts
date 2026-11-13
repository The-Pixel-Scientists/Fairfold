// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the label screens read and send. Bodies hold label and submission ids
// and a label's name and colour; the acting member comes from the session.

import { call } from '@pixel-scientists/domain/api';

import {
  archiveLabel,
  changeLabelsInBulk,
  createLabel,
  listLabels,
  updateLabel,
} from '../../../contracts/index.ts';
import type { LabelColour } from '../../../contracts/index.ts';

export const loadLabels = () => call(listLabels, {});

export const changeLabelsOf = (
  submissionIds: readonly string[],
  add: readonly string[],
  remove: readonly string[],
) =>
  call(changeLabelsInBulk, {
    body: { submissionIds: [...submissionIds], add: [...add], remove: [...remove] },
  });

export const addLabel = (name: string, colour: LabelColour) =>
  call(createLabel, { body: { name, colour } });

export const editLabel = (labelId: string, name: string, colour: LabelColour) =>
  call(updateLabel, { params: { labelId }, body: { name, colour } });

export const archiveOne = (labelId: string) => call(archiveLabel, { params: { labelId } });
