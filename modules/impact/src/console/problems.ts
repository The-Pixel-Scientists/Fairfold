// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API names a field by its path in the request, and the page by the id
// of its control. `naming` renames the fields of a problem an action throws.

import { ProblemError } from '@pixel-scientists/domain/api';

export function naming(rename: (field: string) => string, action: () => Promise<void>) {
  return async () => {
    try {
      await action();
    } catch (error) {
      if (!(error instanceof ProblemError) || error.errors.length === 0) throw error;
      throw new ProblemError(error.status, error.detail, {
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
        errors: error.errors.map(({ field, message }) => ({ field: rename(field), message })),
      });
    }
  };
}

/** The field a problem names, less `body.` and anything inside it: `body.target` is `target`. */
export function topField(field: string): string {
  return field.replace(/^body\./, '').split('.')[0] ?? field;
}
