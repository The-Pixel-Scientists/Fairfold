// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's contribution to erasure (ADR 0016, ADR 0027): the
// personal and special category answers of every application whose
// applicant is an erased party, removed by stable field id through
// grants.clear_answer_fields(), the approved function, which refuses until
// the applicant is erased. Each answer's class comes from the form version
// the application pinned (rule 7); a key that version does not ask counts
// as special category and goes too. Public and internal answers, scores,
// decisions and statuses stay, so erasure changes no outcome (rules 8 and 9).
// Every file linked to those applications is erased through app.erase_file(),
// whatever its question's class or its scan state: the database clears its
// name, hash and key and keeps the link, and the file sweep then deletes the
// object, which no row points at. The bodies of the notes and messages on
// those applications are cleared through app.erase_subject_notes(), which keeps
// their ids, sides and times, and the notifications to the person are failed
// and lose their recipient. Reminders to the person, whether as applicant or
// as reviewer, lose their recipient through grants.erase_reminders(). It runs
// whether or not the tenant has the module switched on.

import { classifyAnswers, pinnedDefinitions } from '@pixel-scientists/db';
import type { Answers } from '@pixel-scientists/domain/forms';
import type { ErasureContribution } from '@pixel-scientists/domain/platform/subject-access';
import { partyErasureTarget, runningErasureRequest } from '@pixel-scientists/party/server';

import type { Tx } from './programme/tables.ts';

type Tables = Record<string, Record<string, unknown>>;

/**
 * Clears the recipient of each reminder to the parties this tenant has, which the approved
 * function refuses unless they are already erased here. A party of another tenant is not here, so
 * nothing is touched.
 */
async function eraseReminders(
  tx: Tx,
  partyIds: readonly string[],
): Promise<Record<string, number>> {
  let cleared = 0;
  for (const partyId of partyIds) {
    if ((await partyErasureTarget(tx, partyId)) === null) continue;
    const { counts } = await tx
      .selectNoFrom((eb) =>
        eb.fn<Record<string, number>>('grants.erase_reminders', [eb.val(partyId)]).as('counts'),
      )
      .executeTakeFirstOrThrow();
    cleared += counts['grants.reminder_email'] ?? 0;
  }
  return { 'grants.reminder_email': cleared };
}

export const grantsErasure: ErasureContribution<'grants', Tx> = {
  module: 'grants',
  async erase(tx, subjects) {
    const reminders = await eraseReminders(
      tx,
      subjects.map(({ partyId }) => partyId),
    );
    const applications = await tx
      .$extendTables<Tables>()
      .selectFrom('grants.application')
      .select(['id', 'applicant_person_id', 'answers'])
      .where(
        'applicant_person_id',
        'in',
        subjects.map(({ partyId }) => partyId),
      )
      .orderBy('id')
      .execute();
    if (applications.length === 0) return { 'grants.application': 0, 'app.file': 0, ...reminders };
    const ids = applications.map((row) => String(row['id']));
    const definitions = await pinnedDefinitions(tx, ids);
    let changed = 0;
    for (const row of applications) {
      const id = String(row['id']);
      const definition = definitions.get(id);
      if (!definition) throw new Error('An application has no pinned form version.');
      const fieldIds = Object.entries(classifyAnswers(definition, row['answers'] as Answers))
        .filter(
          ([, { classification }]) => classification !== 'public' && classification !== 'internal',
        )
        .map(([fieldId]) => fieldId);
      if (fieldIds.length === 0) continue;
      const { cleared } = await tx
        .selectNoFrom((eb) =>
          eb.fn<number>('grants.clear_answer_fields', [eb.val(id), eb.val(fieldIds)]).as('cleared'),
        )
        .executeTakeFirstOrThrow();
      changed += cleared;
    }

    const requestId = await runningErasureRequest(
      tx,
      subjects.map(({ partyId }) => partyId),
    );
    const links = await tx
      .$extendTables<Tables>()
      .selectFrom('grants.application_file')
      .select('file_id')
      .where('application_id', 'in', ids)
      .orderBy('id')
      .execute();
    let files = 0;
    for (const link of links) {
      const { erased } = await tx
        .selectNoFrom((eb) =>
          eb
            .fn<boolean>('app.erase_file', [eb.val(String(link['file_id'])), eb.val(requestId)])
            .as('erased'),
        )
        .executeTakeFirstOrThrow();
      if (erased) files++;
    }

    // Every erased applicant here has applications, and the function refuses a party erased elsewhere.
    const notes: Record<string, number> = {};
    for (const partyId of new Set(applications.map((row) => String(row['applicant_person_id'])))) {
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb.fn<Record<string, number>>('app.erase_subject_notes', [eb.val(partyId)]).as('counts'),
        )
        .executeTakeFirstOrThrow();
      for (const [table, n] of Object.entries(counts)) notes[table] = (notes[table] ?? 0) + n;
    }
    return { 'grants.application': changed, 'app.file': files, ...notes, ...reminders };
  },
};
