// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant routes for integration tests: the programme set-up API with
// open rounds, published forms, and applicants who each have an organisation.

import type { Application } from '@pixel-scientists/grants/contracts';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import type { Mail } from '../src/modules.ts';
import { question, title } from './forms-api.ts';
import {
  answer,
  programmeBody,
  roundBody,
  rowsOf,
  startProgrammeApi,
  type Method,
  type Round,
} from './programme-api.ts';
import { addMember, type Member } from './settings-api.ts';

const DAY = 86_400_000;

/** A time in the tenant's zone, as the round routes take it, `days` from now. */
export const inDays = (days: number): string =>
  new Date(Date.now() + days * DAY).toISOString().slice(0, 16);

export const charity = question('f_charity', 'yes_no', 'Are you a registered charity?', {
  required: true,
  eligibility: { stopWhen: false, explanation: 'Only registered charities can apply.' },
});
export const haveWeb = question('f_haveweb', 'yes_no', 'Do you have a website?');
export const web = question('f_web', 'url', 'Website address', {
  conditions: [{ field: 'f_haveweb', equals: true }],
});
export const turnover = question('f_turnover', 'number', 'Annual turnover', {
  audiences: 'aggregate_only',
});
export const accounts = question('f_accounts', 'file', 'Your accounts');
export const fields = [charity, title, haveWeb, web, turnover];

/** Answers that pass a submission of `fields`. */
export const complete = { f_charity: true, f_title: 'Village hall roof', f_haveweb: false };

export const organisationBody = (name: string) => ({
  name,
  legalForm: 'community_benefit_society',
  identifiers: [{ scheme: 'GB-CHC', identifier: '1234567' }],
  registeredAddress: { line1: '1 High Street', town: 'Northfield', postcode: 'NF1 2AB' },
});

export interface Fixture {
  readonly programmeId: string;
  readonly round: Round;
  readonly versionId: string;
}

export async function startApplicationsApi(port: string, mail?: Mail) {
  const t = await startProgrammeApi(port, mail);
  const ann = t.applicantA;
  const ben = await addMember(t.tenantA, 'portal', 'applicant');
  const cat = await addMember(t.tenantB, 'portal', 'applicant');

  /** A programme with a round and a published form, made by `manager`, taking applications unless changed. */
  async function openRound(
    manager: Member = t.managerA,
    formFields: object[] = fields,
    change: { programme?: object; round?: object } = {},
  ): Promise<Fixture> {
    const programme = await answer<{ id: string }>(
      t.send(
        manager,
        'POST',
        '/console/programmes',
        programmeBody({ status: 'open', ...change.programme }),
      ),
      201,
    );
    const round = await answer<Round>(
      t.send(
        manager,
        'POST',
        `/console/programmes/${programme.id}/rounds`,
        roundBody({ opensAt: inDays(-3), closesAt: inDays(7), ...change.round }),
      ),
      201,
    );
    const publish = async (): Promise<string> => {
      const draft = await answer<{ id: string }>(
        t.send(manager, 'POST', `/console/rounds/${round.id}/form-versions`),
        201,
      );
      await answer(
        t.send(manager, 'PUT', `/console/form-versions/${draft.id}/definition`, {
          definition: { sections: [{ id: 's_about', title: 'About', fields: formFields }] },
        }),
      );
      return (
        await answer<{ id: string }>(
          t.send(manager, 'POST', `/console/form-versions/${draft.id}/publish`),
        )
      ).id;
    };
    return { programmeId: programme.id, round, versionId: await publish() };
  }

  /** An organisation the applicant is the current contact for. */
  const organisationOf = async (member: Member, name = 'Northfield Allotment Society') =>
    (
      await answer<{ id: string }>(
        t.send(member, 'POST', '/portal/organisations', organisationBody(name)),
        201,
      )
    ).id;

  const startPath = (roundId: string) => `/portal/rounds/${roundId}/applications`;

  /** A draft the applicant starts for a new organisation of theirs. */
  async function aDraft(member: Member, roundId: string): Promise<Application> {
    const organisationId = await organisationOf(member);
    return answer<Application>(t.send(member, 'POST', startPath(roundId), { organisationId }), 201);
  }

  const path = (id: string, tail = '') => `/portal/applications/${id}${tail}`;

  const save = (member: Member, application: Application, answers: object, basedOn?: number) =>
    t.send(member, 'PUT', path(application.id, '/answers'), {
      basedOn: basedOn ?? application.answersVersion,
      answers,
    });

  /** The draft with `answers` saved, as the API now holds it. */
  async function saved(member: Member, application: Application, answers: object) {
    await answer(save(member, application, answers));
    return answer<Application>(t.send(member, 'GET', path(application.id)));
  }

  const submit = (member: Member, application: Application) =>
    t.send(member, 'POST', path(application.id, '/submit'), {
      basedOn: application.answersVersion,
    });

  /** Changes a round as the migrator, as the passing of time would. */
  const changeRound = (roundId: string, set: string) =>
    asMigratorIn(t.tenantA.id, (client) =>
      client.query(`UPDATE grants.round SET ${set} WHERE id = $1`, [roundId]).then(() => undefined),
    );

  /** Changes a programme as the migrator, as a staff member's edit would. */
  const changeProgramme = (programmeId: string, set: string) =>
    asMigratorIn(t.tenantA.id, (client) =>
      client
        .query(`UPDATE grants.programme SET ${set} WHERE id = $1`, [programmeId])
        .then(() => undefined),
    );

  /** Every applicant route, with a valid request for the ids given. */
  const everyRoute = (roundId: string, id: string): [Method, string, unknown][] => [
    ['GET', '/portal/rounds', undefined],
    ['GET', `/portal/rounds/${roundId}`, undefined],
    ['POST', startPath(roundId), { organisationId: id }],
    ['GET', '/portal/applications', undefined],
    ['GET', path(id), undefined],
    ['PUT', path(id, '/answers'), { basedOn: 1, answers: {} }],
    ['POST', path(id, '/eligibility-check'), undefined],
    ['POST', path(id, '/submit'), { basedOn: 1 }],
    ['POST', path(id, '/withdraw'), undefined],
  ];

  return {
    ...t,
    ann,
    ben,
    cat,
    openRound,
    organisationOf,
    aDraft,
    startPath,
    path,
    save,
    saved,
    submit,
    changeRound,
    changeProgramme,
    everyRoute,
    rows: <T extends object>(text: string, values: unknown[] = []) =>
      rowsOf<T>(t.tenantA, text, values),
  };
}

export type ApplicationsApi = Awaited<ReturnType<typeof startApplicationsApi>>;
