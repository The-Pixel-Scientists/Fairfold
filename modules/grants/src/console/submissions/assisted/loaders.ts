// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the assisted journey reads and sends. The organisation and its
// contact are named once, when it starts; the member who acts is the
// session's, so no request names a member.

import { call } from '@pixel-scientists/domain/api';
import { getOrganisation } from '@pixel-scientists/party/contracts';

import {
  checkAssistedEligibility,
  getAssistedApplication,
  listAssistedApplications,
  saveAssistedAnswers,
  startAssistedApplication,
  submitAssistedApplication,
} from '../../../contracts/index.ts';
import type { SaveAnswersInput, StartAssistedInput } from '../../../contracts/index.ts';

export const loadAssisted = (applicationId: string) =>
  call(getAssistedApplication, { params: { applicationId } });

export const loadAssistedDrafts = (roundId: string) =>
  call(listAssistedApplications, { params: { roundId } });

export const loadContacts = (organisationId: string) =>
  call(getOrganisation, { params: { organisationId } }).then(({ contacts }) => contacts);

export const startAssisted = (roundId: string, body: StartAssistedInput) =>
  call(startAssistedApplication, { params: { roundId }, body });

export const saveAssisted = (applicationId: string, body: SaveAnswersInput) =>
  call(saveAssistedAnswers, { params: { applicationId }, body });

export const checkAssisted = (applicationId: string) =>
  call(checkAssistedEligibility, { params: { applicationId } });

export const submitAssisted = (applicationId: string, basedOn: number) =>
  call(submitAssistedApplication, { params: { applicationId }, body: { basedOn } });
