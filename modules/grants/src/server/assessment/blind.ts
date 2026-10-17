// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form as a blind reviewer is sent it (ADR 0004). A field stays only
// where `canSee` says a blind reviewer may see its answer, so identity
// fields, aggregate-only fields, file questions and content blocks are gone
// with their labels, and a section with no field left goes too. The client
// draws only what is listed here. A condition a kept field holds can read
// only another kept field: the form rules refuse any other when the form is
// published.

import { canSee, type FormDefinition } from '@pixel-scientists/domain/forms';

/** The definition for a blind reviewer, or null where it leaves no question to show. */
export function blindDefinition(definition: FormDefinition): FormDefinition | null {
  const sections = definition.sections.flatMap((section) => {
    const fields = section.fields.filter((field) => canSee(field, 'blind_reviewer'));
    return fields.length === 0 ? [] : [{ ...section, fields }];
  });
  return sections.length === 0 ? null : { sections };
}
