// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's form versions. A round has at most one draft; publishing makes
// it a fixed version that applications pin (architecture rule 7). The
// database checks the same values.

import { z } from 'zod';

/** Each status, with the words the console shows for it. */
export const formVersionStatuses = {
  draft: 'Draft',
  published: 'Published',
} as const;

export type FormVersionStatus = keyof typeof formVersionStatuses;

export const formVersionStatusSchema = z.enum(
  Object.keys(formVersionStatuses) as [FormVersionStatus, ...FormVersionStatus[]],
);
