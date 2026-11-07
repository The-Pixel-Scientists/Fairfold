// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owners and labels on submitted applications (E7), as the console sends
// and reads them. Inputs are strict and never name a tenant, an actor or a
// person by email: an owner is a membership id, a label a label id.
//
// A label set is tenant configuration (rule 10). Creating, renaming,
// recolouring or archiving a label records a configuration version of
// entity type `grants.label` (labelConfigEntityType), whose entity id is the
// label's id, with labelDiff()'s changes by field path. That entity type is
// not yet in the platform's closed list (`platform/settings/config.ts`), so
// the server waits for it. Labels are archived, never deleted, so history
// keeps its meaning: an archived label stays on the applications that have
// it, and the server refuses to apply it again (triageMessages.labelArchived).
// Names are unique in the tenant in any case (triageMessages.labelTaken).

import { idSchema } from '@pixel-scientists/domain';
import { tagLabelSchema } from '@pixel-scientists/domain/notes';
import { z } from 'zod';

import { configDiff, type ConfigDiff } from '../programme/config.ts';
import { programmeMessages, says as programmeSays } from '../programme/messages.ts';
import { says, triageMessages } from './messages.ts';

export const labelConfigEntityType = 'grants.label';

/** The most submissions one bulk change takes, as a stage move does. */
export const MAX_TRIAGE_SUBMISSIONS = 200;

/** The most labels one change adds, and the most it removes. */
export const MAX_LABEL_CHANGES = 20;

/** A label's colour: the name of a theme token, the console's tag tones, never a colour value. */
export const labelColours = ['neutral', 'info', 'success', 'warning', 'danger'] as const;

export const labelColourSchema = z.enum(labelColours);

export type LabelColour = z.infer<typeof labelColourSchema>;

const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** Ids, each once, at most `max`, and at least `min`. */
export function idListSchema(min: number, max: number) {
  return z
    .array(idSchema)
    .min(min)
    .max(max)
    .refine(unique, programmeSays(programmeMessages.listedOnce));
}

/** A new label, or a label's new name and colour; no colour means neutral. */
export const labelInputSchema = z.strictObject({
  name: tagLabelSchema,
  colour: labelColourSchema.nullable().default(null),
});

export type LabelInput = z.input<typeof labelInputSchema>;

export const labelSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  colour: labelColourSchema.nullable(),
  archived: z.boolean(),
});

export type Label = z.infer<typeof labelSchema>;

/** The tenant's labels by name, archived ones included and marked. */
export const labelListSchema = z.strictObject({ labels: z.array(labelSchema) });

export type LabelList = z.infer<typeof labelListSchema>;

/** A label as its versions are compared; `before` is null for a new label. */
export function labelDiff(before: Omit<Label, 'id'> | null, after: Omit<Label, 'id'>): ConfigDiff {
  const flat = ({ name, colour, archived }: Omit<Label, 'id'>) => ({ name, colour, archived });
  return configDiff(before === null ? null : flat(before), flat(after));
}

/** A member who owns an application, named from their person record; `name` is null when it has none. */
const ownerSchema = z.strictObject({ membershipId: idSchema, name: z.string().nullable() });

/** An application's owner after a change, or none. */
export const ownerAnswerSchema = z.strictObject({ owner: ownerSchema.nullable() });

export type OwnerAnswer = z.infer<typeof ownerAnswerSchema>;

/** The membership to own the application, or null to clear its owner. */
export const ownerInputSchema = z.strictObject({ ownerId: idSchema.nullable() });

export type OwnerInput = z.infer<typeof ownerInputSchema>;

const submissionIds = idListSchema(1, MAX_TRIAGE_SUBMISSIONS);

export const bulkOwnerInputSchema = z.strictObject({ submissionIds, ...ownerInputSchema.shape });

export type BulkOwnerInput = z.infer<typeof bulkOwnerInputSchema>;

const labelIds = idListSchema(0, MAX_LABEL_CHANGES).default([]);

interface LabelSets {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

const someLabel = ({ add, remove }: LabelSets) => add.length + remove.length > 0;
const notBoth = ({ add, remove }: LabelSets) => !add.some((id) => remove.includes(id));
const notBothSays = { ...says(triageMessages.addOrRemove), path: ['remove'] };

/**
 * Labels to add and to remove, as sets: adding one already there or removing
 * one that is not is no error. At least one label, and none in both lists.
 */
export const labelChangeInputSchema = z
  .strictObject({ add: labelIds, remove: labelIds })
  .refine(someLabel, says(triageMessages.chooseLabel))
  .refine(notBoth, notBothSays);

export type LabelChangeInput = z.input<typeof labelChangeInputSchema>;

export const bulkLabelChangeInputSchema = z
  .strictObject({ submissionIds, add: labelIds, remove: labelIds })
  .refine(someLabel, says(triageMessages.chooseLabel))
  .refine(notBoth, notBothSays);

export type BulkLabelChangeInput = z.input<typeof bulkLabelChangeInputSchema>;

/** An application's labels after a change, archived ones included. */
export const appliedLabelsSchema = z.strictObject({ labels: z.array(labelSchema) });

export type AppliedLabels = z.infer<typeof appliedLabelsSchema>;

/** How many applications a bulk change changed; those already as asked are left as they are. */
export const bulkTriageResultSchema = z.strictObject({ changed: z.int() });

export type BulkTriageResult = z.infer<typeof bulkTriageResultSchema>;
