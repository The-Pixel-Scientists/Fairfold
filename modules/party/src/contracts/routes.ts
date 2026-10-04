// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Party routes (ADR 0004, ADR 0017). Applicants reach their own person
// record (`own_person`, from the session) and organisations they are a
// current contact for (`own_organisation`, by `:organisationId`). Staff
// with `party.records.read` read any record in their tenant. Party is
// always on, so these keep working when grants is switched off.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  consentSchema,
  consoleOrganisationSchema,
  consolePersonSchema,
  organisationPageSchema,
  portalOrganisationListSchema,
  portalOrganisationSchema,
  profileSchema,
} from './answers.ts';
import {
  consentChangeSchema,
  organisationInputSchema,
  organisationQuerySchema,
  profileInputSchema,
} from './inputs.ts';

const portal = {
  audience: 'portal',
  module: 'party',
  permission: 'party.profile.manage',
} as const;

const ownPerson = { ...portal, scope: 'own_person' } as const;

const ownOrganisation = {
  ...portal,
  scope: 'own_organisation',
  params: z.strictObject({ organisationId: idSchema }),
} as const;

const staff = {
  audience: 'console',
  module: 'party',
  permission: 'party.records.read',
  scope: 'tenant',
} as const;

export const getProfile = defineRoute({
  ...ownPerson,
  method: 'GET',
  path: '/portal/profile',
  summary: 'Read your profile and contact choices, starting it from your account on first visit',
  responses: { 200: profileSchema },
});

export const updateProfile = defineRoute({
  ...ownPerson,
  method: 'PUT',
  path: '/portal/profile',
  summary: 'Change your name and phone number',
  body: profileInputSchema,
  responses: { 200: profileSchema },
});

export const recordConsent = defineRoute({
  ...ownPerson,
  method: 'POST',
  path: '/portal/profile/consents',
  summary: 'Record whether you agree to be contacted, for one purpose and channel',
  body: consentChangeSchema,
  responses: { 201: consentSchema },
});

export const listMyOrganisations = defineRoute({
  ...ownPerson,
  method: 'GET',
  path: '/portal/organisations',
  summary: 'List the organisations you are a contact for',
  responses: { 200: portalOrganisationListSchema },
});

export const createOrganisation = defineRoute({
  ...ownPerson,
  method: 'POST',
  path: '/portal/organisations',
  summary: 'Add an organisation, with you as its contact',
  body: organisationInputSchema,
  responses: { 201: portalOrganisationSchema },
});

export const getMyOrganisation = defineRoute({
  ...ownOrganisation,
  method: 'GET',
  path: '/portal/organisations/:organisationId',
  summary: 'Read one of your organisations',
  responses: { 200: portalOrganisationSchema },
});

export const updateMyOrganisation = defineRoute({
  ...ownOrganisation,
  method: 'PUT',
  path: '/portal/organisations/:organisationId',
  summary: "Change one of your organisation's details",
  body: organisationInputSchema,
  responses: { 200: portalOrganisationSchema },
});

export const listOrganisations = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/organisations',
  summary: 'List organisations by name, searching by name or identifier, a page at a time',
  query: organisationQuerySchema,
  responses: { 200: organisationPageSchema },
});

export const getOrganisation = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/organisations/:organisationId',
  summary: 'Read an organisation with its identifiers and contacts',
  params: z.strictObject({ organisationId: idSchema }),
  responses: { 200: consoleOrganisationSchema },
});

export const getPerson = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/people/:personId',
  summary: 'Read a person with their organisations and contact choices',
  params: z.strictObject({ personId: idSchema }),
  responses: { 200: consolePersonSchema },
});

export const partyRoutes = {
  getProfile,
  updateProfile,
  recordConsent,
  listMyOrganisations,
  createOrganisation,
  getMyOrganisation,
  updateMyOrganisation,
  listOrganisations,
  getOrganisation,
  getPerson,
} as const;
