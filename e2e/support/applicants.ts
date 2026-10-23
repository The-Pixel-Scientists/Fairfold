// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Applicants of the journey, made the way people are: an email address, an
// emailed link, a password. The first is made through the portal's pages in
// step 7; the others, whom the later steps need in numbers, through the API's
// own routes with the link read from Mailpit.

import { Api, signInApplicant } from './api.ts';
import { portalOrigin, type Slug } from './env.ts';
import { tokenOf, waitForLink } from './mail.ts';
import { updateState } from './state.ts';

export const APPLICANT_PASSWORD = 'a long passphrase for the demo';

/** A new applicant's address, which no earlier run used. */
export const addressFor = (name: string): string =>
  `${name}-${String(Date.now())}@example.org`.toLowerCase();

/** Remembers a person made by the journey, so that pages and API sessions can sign them in. */
export function registerPerson(name: string, email: string): void {
  updateState((state) => {
    state.people[name] = { email, password: APPLICANT_PASSWORD };
  });
}

/** Signs up by email and sets a password, through the API, and leaves the applicant in the state. */
export async function createApplicantAccount(
  name: string,
  slug: Slug = 'northfield',
): Promise<Api> {
  const email = addressFor(name);
  const visitor = await Api.open(portalOrigin);
  await visitor.ok('POST', `/auth/tenants/${slug}/sign-up`, { json: { email } });
  const token = tokenOf(await waitForLink(email, '/sign-up/complete'));
  await visitor.ok('POST', '/auth/sign-up/complete', {
    json: { token, password: APPLICANT_PASSWORD },
  });
  await visitor.dispose();
  registerPerson(name, email);
  return signInApplicant(slug, name);
}
