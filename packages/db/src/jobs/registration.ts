// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every defined queue, and its dead-letter queue, must be registered in
// app.job_queue with the same kind, by the migration that creates it.

import { sql, type Kysely } from 'kysely';

import { definedQueues } from './queue.ts';

/** What is wrong with the registration of each defined queue: queue names and kinds only. */
export async function queueRegistrationProblems<DB>(db: Kysely<DB>): Promise<string[]> {
  const { rows } = await sql<{ name: string; kind: string; dead_letter: string | null }>`
    SELECT r.name, r.kind, q.dead_letter
      FROM app.job_queue AS r
      JOIN pgboss.queue AS q ON q.name = r.name
  `.execute(db);
  const registered = new Map(rows.map((row) => [row.name, row]));
  return definedQueues().flatMap(({ name, kind }) => {
    const row = registered.get(name);
    if (row === undefined) return [`${name} is not registered in app.job_queue`];
    if (row.kind !== kind) return [`${name} is registered as a ${row.kind} queue, not ${kind}`];
    const dead = row.dead_letter === null ? undefined : registered.get(row.dead_letter);
    if (row.dead_letter !== null && dead?.kind !== kind) {
      return [`${name} has a dead-letter queue that is not a registered ${kind} queue`];
    }
    return [];
  });
}
