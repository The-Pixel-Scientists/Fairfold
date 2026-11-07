// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A draft as the server will read it: checked with the same contract, so the
// builder and the server give the same problems in the same words.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { problemsOf } from '@pixel-scientists/ui/form-builder';
import type { Problem } from '@pixel-scientists/ui/form-builder';

import { formDefinitionInputSchema } from '../../contracts/index.ts';

/**
 * The definition as the server will read it (its text trimmed), or the
 * problems that stop it, in the words the server uses for each.
 */
export function checkDefinition(
  definition: unknown,
): { definition: FormDefinition; problems: [] } | { definition: null; problems: Problem[] } {
  const result = formDefinitionInputSchema.safeParse(definition);
  return result.success
    ? { definition: result.data, problems: [] }
    : { definition: null, problems: problemsOf(result.error.issues) };
}
