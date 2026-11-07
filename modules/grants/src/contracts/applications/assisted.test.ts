// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { grantsAuditActions } from '../audit.ts';
import { submissionSchema } from '../submissions/answers.ts';
import { answersSavedSchema, eligibilitySchema } from './answers.ts';
import * as assisted from './assisted.ts';
import { saveAnswersInputSchema, submitApplicationInputSchema } from './inputs.ts';

const routes = Object.values(assisted.assistedRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('assisted submission routes', () => {
  it('keep every route rule, for staff who assist applicants in the tenant', () => {
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.applications.assist',
        scope: 'tenant',
      });
    }
  });

  it('need step-up to start and submit, and start idempotently', () => {
    const stepped = routes.filter((route) => 'stepUp' in route);
    expect(stepped).toEqual([
      assisted.startAssistedApplication,
      assisted.submitAssistedApplication,
    ]);
    expect(assisted.startAssistedApplication.idempotent).toBe(true);
  });

  it("use the portal's answer, eligibility and submit schemas, and answer a staff submission", () => {
    expect(assisted.saveAssistedAnswers.body).toBe(saveAnswersInputSchema);
    expect(assisted.saveAssistedAnswers.responses[200]).toBe(answersSavedSchema);
    expect(assisted.checkAssistedEligibility.responses[200]).toBe(eligibilitySchema);
    expect(assisted.submitAssistedApplication.body).toBe(submitApplicationInputSchema);
    expect(assisted.submitAssistedApplication.responses[200]).toBe(submissionSchema);
  });

  it('audit every route but the list, including each save made for the applicant', () => {
    const audited = Object.entries(assisted.assistedAuditActions)
      .filter(([, actions]) => actions.length > 0)
      .map(([name]) => name);
    expect(audited).toEqual(
      Object.keys(assisted.assistedRoutes).filter((name) => name !== 'listAssistedApplications'),
    );
    for (const actions of Object.values(assisted.assistedAuditActions)) {
      for (const action of actions) expect(grantsAuditActions).toContain(action);
    }
    expect(assisted.assistedAuditActions.saveAssistedAnswers).toEqual([
      'grants.application.answers_saved_on_behalf',
    ]);
  });

  it('name the applicant as the organisation and its contact, and never a member, user or tenant', () => {
    const { body } = assisted.startAssistedApplication;
    const start = { organisationId: ID, contactPersonId: ID };
    expect(body.parse(start)).toEqual(start);
    for (const extra of [
      { membershipId: ID },
      { submittedBy: ID },
      { userId: ID },
      { tenantId: ID },
      { submissionRoute: 'portal' },
    ]) {
      expect(body.safeParse({ ...start, ...extra }).success).toBe(false);
    }
    expect(body.safeParse({ organisationId: ID }).success).toBe(false);
  });
});
