// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Helpers for the form builder routes' integration tests: definitions as a
// client sends them, and the requests and readers the tests share.

import { parseDefinition } from '@pixel-scientists/domain/forms';
import type { FormVersion } from '@pixel-scientists/grants/contracts';

import { answer, rowsOf, type Method, type ProgrammeApi, type Round } from './programme-api.ts';
import type { Member } from './settings-api.ts';

export const question = (id: string, type: string, label: string, change: object = {}) => ({
  id,
  type,
  label,
  ...change,
});
export const title = question('f_title', 'short_text', 'Project title', { required: true });
export const budget = question('f_budget', 'currency', 'Total cost');
export const notes = question('f_notes', 'long_text', 'Anything else?');

/** A definition as a client sends it, with its defaults left out. */
export const form = (...fields: object[]) => ({
  sections: [{ id: 's_about', title: 'About your project', fields }],
});

/** The definition as the form engine stores it, with its defaults written out. */
export function stored(input: unknown) {
  const parsed = parseDefinition(input);
  if (!parsed.success) throw new Error('The test definition is not valid.');
  return parsed.data;
}

/** Every form route, with a valid request for the ids given. */
export const everyRoute = (roundId: string, versionId: string): [Method, string, unknown][] => [
  ['GET', `/console/rounds/${roundId}/form-versions`, undefined],
  ['POST', `/console/rounds/${roundId}/form-versions`, undefined],
  ['GET', `/console/form-versions/${versionId}`, undefined],
  ['PUT', `/console/form-versions/${versionId}/definition`, { definition: form(title) }],
  ['POST', `/console/form-versions/${versionId}/publish`, undefined],
  ['DELETE', `/console/form-versions/${versionId}`, undefined],
];

/** The requests and readers on a started application, for tenant A's programme manager unless told. */
export function formsApi(t: ProgrammeApi) {
  const start = (round: Round, member: Member = t.managerA) =>
    answer<FormVersion>(t.send(member, 'POST', `/console/rounds/${round.id}/form-versions`), 201);

  const save = (member: Member, id: string, definition: unknown) =>
    t.send(member, 'PUT', `/console/form-versions/${id}/definition`, { definition });

  const publish = (member: Member, id: string) =>
    answer<FormVersion>(t.send(member, 'POST', `/console/form-versions/${id}/publish`));

  return {
    start,
    save,
    publish,
    roundOfA: async () => t.aRound((await t.aProgramme()).id),
    read: (id: string) =>
      answer<FormVersion>(t.send(t.managerA, 'GET', `/console/form-versions/${id}`)),
    /** A draft of the round, saved with `fields` and published. */
    async aPublished(round: Round, ...fields: object[]) {
      const draft = await start(round);
      await answer(save(t.managerA, draft.id, form(...fields)));
      return publish(t.managerA, draft.id);
    },
    /** The round's versions as stored, oldest first. */
    rowsOfRound: (roundId: string) =>
      rowsOf<{ id: string; version: number; status: string; updated_by: string }>(
        t.tenantA,
        'SELECT id, version, status, updated_by FROM grants.form_version WHERE round_id = $1 ORDER BY version',
        [roundId],
      ),
    /** What the form routes have left in tenant A, to see that a refused request changed nothing. */
    countAll: () =>
      rowsOf<Record<string, number>>(
        t.tenantA,
        `SELECT (SELECT count(*) FROM grants.form_version)::int AS versions,
                (SELECT count(*) FROM app.config_version WHERE entity_type = 'grants.form_version')::int AS configs,
                (SELECT count(*) FROM app.audit_event WHERE action LIKE 'grants.form_version.%')::int AS events`,
      ),
  };
}

export type FormsApi = ReturnType<typeof formsApi>;
