// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the 360Giving section reads and sends. Defined once, here, so a hook
// reads again only when the page asks it to.

import { call } from '@pixel-scientists/domain/api';

import {
  get360GivingExport,
  getPublisherSetting,
  savePublisherSetting,
} from '../../contracts/index.ts';
import type { PublisherSettingInput, ThreeSixtyGivingQuery } from '../../contracts/index.ts';

export const loadPublisher = () => call(getPublisherSetting, {}).then((answer) => answer.publisher);

export const savePublisher = (body: PublisherSettingInput) => call(savePublisherSetting, { body });

export const loadExport = (query: ThreeSixtyGivingQuery) => call(get360GivingExport, { query });
