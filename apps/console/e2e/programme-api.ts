// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the programme set-up specs: a funder that keeps
// what is saved, so a spec can set up a programme and see it afterwards, in
// its lists and in its configuration history. It holds one programme and one
// round, with fixed ids, and writes each change into the history the way the
// contract describes (a diff of values by path). Answers are plain JSON in
// the shape of the contracts in modules/grants/src/contracts/programme; the
// console checks each one against its contract.

import { configDiff, defaultEmailTemplates } from '@pixel-scientists/grants/contracts';
import type {
  ConfigObject,
  ConfigVersion,
  Criterion,
  EmailTemplates,
  Programme,
  Round,
  Stage,
} from '@pixel-scientists/grants/contracts';
import type { Page } from '@playwright/test';

import { stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';

export const ids = {
  programme: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  round: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  intake: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  review: 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
  decision: 'e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091',
  /** For the stages and criteria a spec adds, in the order it adds them. */
  more: [
    'f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2',
    'a7b8c9d0-e1f2-4a3b-8c5d-6e7f8091a2b3',
    'b8c9d0e1-f2a3-4b4c-9d6e-7f8091a2b3c4',
    'c9d0e1f2-a3b4-4c5d-8e7f-8091a2b3c4d5',
    'd0e1f2a3-b4c5-4d6e-9f80-91a2b3c4d5e6',
    'e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7',
  ],
  author: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
} as const;

const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' }) as const;

export const programme: Programme = {
  id: ids.programme,
  title: 'Community Spaces Fund',
  summary: 'Grants for places where neighbours meet.',
  description: 'Funds repairs, equipment and running costs.',
  status: 'draft',
};

export const round: Round = {
  id: ids.round,
  programmeId: ids.programme,
  title: 'Autumn 2026',
  opensAt: '2026-10-12T09:00',
  closesAt: '2026-11-02T17:00',
  timeZone: 'Europe/London',
  budget: pounds(150_000),
  awardMinimum: pounds(5_000),
  awardMaximum: pounds(25_000),
  latePolicy: 'refuse',
};

const criterion = (id: string, label: string, weight: number): Criterion => ({
  id,
  label,
  guidance: '',
  weight,
  scaleMin: 1,
  scaleMax: 5,
});

const defaultStages = (): Stage[] => [
  { id: ids.intake, name: 'Intake', position: 1, criteria: [] },
  { id: ids.review, name: 'Review', position: 2, criteria: [] },
  { id: ids.decision, name: 'Decision', position: 3, criteria: [] },
];

/** What the funder holds. A spec may change it between steps. */
export interface SetUp {
  programme: Programme | null;
  round: Round | null;
  stages: Stage[];
  templates: EmailTemplates;
  programmeVersions: ConfigVersion[];
  roundVersions: ConfigVersion[];
  /** The ids for new stages and criteria that have been used. */
  used: number;
}

export interface ProgrammeStub {
  setUp: SetUp;
  sent: SentRequest[];
}

const defaultTemplates = (): EmailTemplates => ({
  accepted: { ...defaultEmailTemplates.accepted, version: 1 },
  waitlisted: { ...defaultEmailTemplates.waitlisted, version: 1 },
  declined: { ...defaultEmailTemplates.declined, version: 1 },
});

/** Nothing set up yet. */
export const empty = (): SetUp => ({
  programme: null,
  round: null,
  stages: [],
  templates: defaultTemplates(),
  programmeVersions: [],
  roundVersions: [],
  used: 0,
});

const programmeConfig = (
  { title, summary, description, status }: Programme,
  templates: EmailTemplates,
) =>
  ({
    title,
    summary,
    description,
    status,
    emailTemplates: {
      accepted: { subject: templates.accepted.subject, body: templates.accepted.body },
      waitlisted: { subject: templates.waitlisted.subject, body: templates.waitlisted.body },
      declined: { subject: templates.declined.subject, body: templates.declined.body },
    },
  }) satisfies ConfigObject;

const roundConfig = (r: Round, stages: readonly Stage[]) =>
  ({
    title: r.title,
    opensAt: r.opensAt,
    closesAt: r.closesAt,
    timeZone: r.timeZone,
    budget: r.budget,
    awardMinimum: r.awardMinimum,
    awardMaximum: r.awardMaximum,
    latePolicy: r.latePolicy,
    stages: Object.fromEntries(
      stages.map((stage) => [
        stage.id,
        {
          name: stage.name,
          position: stage.position,
          criteria: Object.fromEntries(
            stage.criteria.map((c) => [
              c.id,
              {
                label: c.label,
                guidance: c.guidance,
                weight: c.weight,
                scaleMin: c.scaleMin,
                scaleMax: c.scaleMax,
              },
            ]),
          ),
        },
      ]),
    ),
  }) satisfies ConfigObject;

/** Writes a version at the head of the history, if anything changed. */
function record(versions: ConfigVersion[], before: ConfigObject | null, after: ConfigObject): void {
  const changes = configDiff(before, after);
  if (changes.length === 0) return;
  const at = new Date(Date.UTC(2026, 9, 12, 8, 0) + versions.length * 3_600_000);
  versions.unshift({
    version: versions.length + 1,
    createdAt: at.toISOString(),
    author: { membershipId: ids.author, name: 'Ada Reed' },
    changes,
  });
}

/** A programme with a round, three stages and a rubric, as it looks once it has been set up. */
export function configured(): SetUp {
  const setUp = empty();
  setUp.programme = { ...programme, status: 'open' };
  setUp.round = round;
  setUp.stages = defaultStages();
  record(setUp.programmeVersions, null, programmeConfig(setUp.programme, setUp.templates));
  record(setUp.roundVersions, null, roundConfig(round, setUp.stages));
  setUp.stages[1] = {
    id: ids.review,
    name: 'Review',
    position: 2,
    criteria: [
      criterion(ids.more[0], 'Need', 5),
      criterion(ids.more[1], 'Approach', 3),
      criterion(ids.more[2], 'Value for money', 2),
    ],
  };
  setUp.used = 3;
  record(
    setUp.roundVersions,
    roundConfig(round, defaultStages()),
    roundConfig(round, setUp.stages),
  );
  return setUp;
}

const ok = (body: unknown) => ({ status: 200, body });

/**
 * A signed-in programme manager of a funder that keeps what is saved. `more`
 * adds or replaces answers, keyed like `GET /console/programmes`.
 */
export async function stubProgrammes(
  page: Page,
  start: SetUp = empty(),
  more: Record<string, Handler> = {},
  permissions?: string[],
): Promise<ProgrammeStub> {
  const setUp = start;
  const programmeBase = `/console/programmes/${ids.programme}`;
  const roundBase = `/console/rounds/${ids.round}`;
  const nextId = () => ids.more[setUp.used++] ?? ids.more[0];

  const saveRound = (next: Round, stages: Stage[], before: Round | null, previous: Stage[]) => {
    record(setUp.roundVersions, before && roundConfig(before, previous), roundConfig(next, stages));
    setUp.round = next;
    setUp.stages = stages;
  };

  const rubric =
    (stageId: string): Handler =>
    (body) => {
      const sent = (body as { criteria: (Partial<Criterion> & { label: string })[] }).criteria;
      const stages = setUp.stages.map((stage) =>
        stage.id === stageId
          ? {
              ...stage,
              criteria: sent.map((item): Criterion => ({
                id: item.id ?? nextId(),
                label: item.label,
                guidance: item.guidance ?? '',
                weight: item.weight ?? 1,
                scaleMin: item.scaleMin ?? 1,
                scaleMax: item.scaleMax ?? 5,
              })),
            }
          : stage,
      );
      if (setUp.round) saveRound(setUp.round, stages, setUp.round, setUp.stages);
      return ok(stages.find((stage) => stage.id === stageId));
    };

  const sent = await stubSignedIn(page, permissions ? { permissions } : {}, {
    'GET /console/programmes': () =>
      ok({
        programmes: setUp.programme
          ? [
              {
                id: setUp.programme.id,
                title: setUp.programme.title,
                summary: setUp.programme.summary,
                status: setUp.programme.status,
                rounds: setUp.round ? [setUp.round] : [],
              },
            ]
          : [],
      }),
    'POST /console/programmes': (body) => {
      const created = { id: ids.programme, ...(body as Omit<Programme, 'id'>) };
      setUp.programme = created;
      record(setUp.programmeVersions, null, programmeConfig(created, setUp.templates));
      return { status: 201, body: created };
    },
    [`GET ${programmeBase}`]: () => ok(setUp.programme),
    [`PUT ${programmeBase}`]: (body) => {
      const before = setUp.programme;
      const changed = { id: ids.programme, ...(body as Omit<Programme, 'id'>) };
      setUp.programme = changed;
      record(
        setUp.programmeVersions,
        before && programmeConfig(before, setUp.templates),
        programmeConfig(changed, setUp.templates),
      );
      return ok(changed);
    },
    [`GET ${programmeBase}/rounds`]: () => ok({ rounds: setUp.round ? [setUp.round] : [] }),
    [`POST ${programmeBase}/rounds`]: (body) => {
      const created: Round = {
        id: ids.round,
        programmeId: ids.programme,
        timeZone: 'Europe/London',
        ...(body as Omit<Round, 'id' | 'programmeId' | 'timeZone'>),
      };
      saveRound(created, defaultStages(), null, []);
      return { status: 201, body: created };
    },
    [`GET ${roundBase}`]: () => ok(setUp.round),
    [`PUT ${roundBase}`]: (body) => {
      const before = setUp.round;
      const changed = { ...(before as Round), ...(body as Partial<Round>) };
      saveRound(changed, setUp.stages, before, setUp.stages);
      return ok(changed);
    },
    [`GET ${roundBase}/stages`]: () => ok({ stages: setUp.stages }),
    [`PUT ${roundBase}/stages`]: (body) => {
      const sentStages = (body as { stages: { id?: string; name: string }[] }).stages;
      const stages = sentStages.map((item, index): Stage => ({
        id: item.id ?? nextId(),
        name: item.name,
        position: index + 1,
        criteria: setUp.stages.find((stage) => stage.id === item.id)?.criteria ?? [],
      }));
      if (setUp.round) saveRound(setUp.round, stages, setUp.round, setUp.stages);
      return ok({ stages });
    },
    [`PUT /console/stages/${ids.intake}/rubric`]: rubric(ids.intake),
    [`PUT /console/stages/${ids.review}/rubric`]: rubric(ids.review),
    [`PUT /console/stages/${ids.decision}/rubric`]: rubric(ids.decision),
    [`GET ${programmeBase}/email-templates`]: () => ok(setUp.templates),
    [`PUT ${programmeBase}/email-templates`]: (body) => {
      const sentTemplates = body as Record<keyof EmailTemplates, { subject: string; body: string }>;
      const before = setUp.programme && programmeConfig(setUp.programme, setUp.templates);
      const next = (name: keyof EmailTemplates) => ({
        ...sentTemplates[name],
        version:
          sentTemplates[name].subject === setUp.templates[name].subject &&
          sentTemplates[name].body === setUp.templates[name].body
            ? setUp.templates[name].version
            : setUp.templates[name].version + 1,
      });
      setUp.templates = {
        accepted: next('accepted'),
        waitlisted: next('waitlisted'),
        declined: next('declined'),
      };
      if (before && setUp.programme) {
        record(setUp.programmeVersions, before, programmeConfig(setUp.programme, setUp.templates));
      }
      return ok(setUp.templates);
    },
    [`GET ${programmeBase}/history`]: () => ok({ versions: setUp.programmeVersions }),
    [`GET ${roundBase}/history`]: () => ok({ versions: setUp.roundVersions }),
    ...more,
  });
  return { setUp, sent };
}
