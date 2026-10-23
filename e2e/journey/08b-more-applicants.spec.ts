// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 8, for the rest of the round: five more groups apply, and a sixth
// applies and then withdraws. They go through the API's own routes, with the
// emailed sign-up link read from Mailpit, so the later steps have a round to
// triage, assess and decide. The first applicant, who worked through the pages
// in the step before, is the sixth submission.

import { applyThroughTheApi, groups } from '../support/applications.ts';
import { needList, readState, updateState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

test.describe('step 8, for the rest of the round: more groups apply', () => {
  test('five groups apply and a sixth applies and withdraws', async () => {
    for (const applicant of groups) {
      const { api, applicationId } = await applyThroughTheApi(applicant);
      const summary = await api.ok<{ status: string }>(
        'GET',
        `/portal/applications/${applicationId}`,
      );
      expect(summary.status, applicant.name).toBe('submitted');
      if (applicant.name === 'applicant7') {
        const withdrawn = await api.ok<{ status: string }>(
          'POST',
          `/portal/applications/${applicationId}/withdraw`,
        );
        expect(withdrawn.status).toBe('withdrawn');
      }
      await api.dispose();
    }
    const state = readState();
    const submitted = [
      'application1Id',
      ...groups.slice(0, 5).map(({ name }) => `${name}ApplicationId`),
    ];
    updateState((next) => {
      next.lists['applicationIds'] = submitted.map((key) => next.ids[key] ?? '');
      next.ids['withdrawnApplicationId'] = state.ids['applicant7ApplicationId'] ?? '';
    });
    expect(needList('applicationIds').every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });
});
