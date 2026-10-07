// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The step-up check, as the previews run it: anything is accepted, as long as
// the form is filled in the way the real one asks (ADR 0010).

import { ProblemError } from '@pixel-scientists/domain/api';
import type { StepUpCredentials } from '@pixel-scientists/ui';

export function checkIdentity({ password, code }: StepUpCredentials): void {
  const errors = [
    ...(password === '' ? [{ field: 'password', message: 'Enter your password.' }] : []),
    ...(/^\d{6}$/.test(code)
      ? []
      : [{ field: 'code', message: 'Enter the 6 digits shown in your authenticator app.' }]),
  ];
  if (errors.length > 0)
    throw new ProblemError(401, 'Check your details and try again.', { errors });
}
