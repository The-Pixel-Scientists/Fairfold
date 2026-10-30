// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a seed scenario holds, and how it is written. Every name, address and
// number in a scenario is synthetic. The seed connects as migrator, which
// forced row-level security binds like any app role (ADR 0003), so it sets
// each tenant in turn and writes that tenant's rows, all in one transaction.
// Actor columns stay null, as for anything the system does, except where the
// schema needs a member: the programme manager publishes forms, moves
// applications on, fills reviewer pools and records decisions, and
// applicants start, check and submit their own.

import { argon2Sync, randomBytes, randomUUID } from 'node:crypto';

import { checkEligibility, parseDefinition } from '@pixel-scientists/domain/forms';
import { permissionsFor, type Preset, type Role } from '@pixel-scientists/domain/platform';
import type pg from 'pg';

/** Given name, family name and role. The address is given.family@<slug>.example. */
export type StaffMember = readonly [givenName: string, familyName: string, role: Role];

export interface Criterion {
  readonly label: string;
  readonly guidance: string;
  readonly weight: number;
}

export interface Round {
  readonly title: string;
  /** Wall-clock times in `timezone`, to the minute, as the round contract takes them. */
  readonly opensAt: string;
  readonly closesAt: string;
  readonly timezone: string;
  readonly budgetMinor: number;
  readonly awardMinMinor: number;
  readonly awardMaxMinor: number;
  readonly latePolicy: 'refuse' | 'accept_and_flag';
  /** In order. Criteria are scored on the default scale, 1 to 5. */
  readonly stages: readonly { readonly name: string; readonly criteria?: readonly Criterion[] }[];
  /** Version 1 of the application form, published the day before the round opens. */
  readonly form?: unknown;
  /** Staff in the round's reviewer pool, by given and family name, added when it closes. */
  readonly reviewers?: readonly (readonly [givenName: string, familyName: string])[];
  readonly applications?: readonly Application[];
}

/**
 * A pool reviewer's assignment to an application at the stage it reached,
 * made a day after it got there, with the scores saved so far, in the order
 * of the stage's criteria. A submitted review scores every criterion, and
 * the database gives it the time the seed runs as its submission time.
 */
export interface Review {
  readonly reviewer: readonly [givenName: string, familyName: string];
  readonly scores: readonly (readonly [score: number, comment: string])[];
  readonly submitted?: boolean;
}

export interface Organisation {
  readonly name: string;
  readonly legalForm: string;
  readonly addressLine1: string;
  readonly town: string;
  readonly postcode: string;
}

/** A recorded decision, never released by the seed: an award has its amount in pence. */
export type Decision =
  | { readonly outcome: 'accepted'; readonly amountMinor: number }
  | { readonly outcome: 'waitlisted' | 'declined' };

/**
 * A submitted application, from an applicant with an account who is a
 * contact for their organisation. Its eligibility is checked when it
 * starts. Submitting puts it in the first stage, and the programme manager
 * moves it on a stage a day after the round closes, up to `stage`.
 */
export interface Application {
  /** Given and family name. The address is given.family@applicants.<slug>.example. */
  readonly applicant: readonly [givenName: string, familyName: string];
  readonly organisation: Organisation;
  readonly answers: Readonly<Record<string, unknown>>;
  /** Wall-clock times in the round's time zone. Late when submitted after the round closes. */
  readonly startedAt: string;
  readonly submittedAt: string;
  readonly withdrawnAt?: string;
  readonly stage: string;
  readonly reviews?: readonly Review[];
  /** Recorded by the programme manager a day after the application reached its stage. */
  readonly decision?: Decision;
}

export interface Template {
  readonly subject: string;
  readonly body: string;
}

export interface Programme {
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly status: 'draft' | 'open' | 'closed';
  readonly rounds: readonly Round[];
  /** Version 1 of each outcome's email. */
  readonly templates: Readonly<Record<'accepted' | 'waitlisted' | 'declined', Template>>;
}

export interface Tenant {
  readonly slug: string;
  readonly name: string;
  readonly staff: readonly StaffMember[];
  /**
   * Set by the first member who manages the tenant's settings. Without one,
   * the tenant has the default look.
   */
  readonly theme?: { readonly brandColour: string; readonly preset: Preset };
  readonly programmes?: readonly Programme[];
}

export type Scenario = readonly Tenant[];

/** A tenant as written: its id, and the ids of the rows written for it, by table. */
export interface SeededTenant {
  readonly id: string;
  readonly slug: string;
  readonly rows: Readonly<Record<string, readonly string[]>>;
}

export const emailOf = (tenant: Tenant, [givenName, familyName]: StaffMember): string =>
  `${givenName}.${familyName}@${tenant.slug}.example`.toLowerCase();

export const applicantEmailOf = (
  tenant: Tenant,
  [givenName, familyName]: Application['applicant'],
): string => `${givenName}.${familyName}@applicants.${tenant.slug}.example`.toLowerCase();

/** Every application in the tenant's rounds. */
export const applicationsOf = (tenant: Tenant): Application[] =>
  (tenant.programmes ?? []).flatMap((programme) =>
    programme.rounds.flatMap((round) => round.applications ?? []),
  );

const unpadded = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/** An Argon2id hash in PHC form, with a new salt and the API's parameters (ADR 0010). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: 19 * 1024,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
  });
  return `$argon2id$v=19$m=19456,t=2,p=1$${unpadded(salt)}$${unpadded(hash)}`;
}

/**
 * Write `scenario` through `client`, connected as migrator, in one
 * transaction. Every account's password is `password`.
 */
export async function writeScenario(
  client: pg.ClientBase,
  scenario: Scenario,
  password: string,
): Promise<SeededTenant[]> {
  await client.query('BEGIN');
  try {
    const seeded: SeededTenant[] = [];
    for (const tenant of scenario) seeded.push(await writeTenant(client, tenant, password));
    await client.query('COMMIT');
    return seeded;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

type Insert = (table: string, values: Readonly<Record<string, unknown>>) => Promise<string>;

/** Inserts through `client`, keeping each new row's id in `rows` under its table. */
function inserter(client: pg.ClientBase, rows: Record<string, string[]>): Insert {
  return async (table, values) => {
    const name = table
      .split('.')
      .map((part) => client.escapeIdentifier(part))
      .join('.');
    const columns = Object.keys(values).map((column) => client.escapeIdentifier(column));
    const parameters = columns.map((_, index) => `$${String(index + 1)}`);
    const { rows: added } = await client.query<{ id: string }>(
      `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${parameters.join(', ')}) RETURNING id`,
      Object.values(values),
    );
    const row = added[0];
    if (!row) throw new Error(`The insert into ${table} returned no row.`);
    (rows[table] ??= []).push(row.id);
    return row.id;
  };
}

/** What the member who publishes forms and moves applications on may do. */
export const MANAGER = ['grants.programmes.manage', 'grants.applications.triage'] as const;

/** What writing a tenant's rows needs. */
interface Writer {
  readonly client: pg.ClientBase;
  readonly insert: Insert;
  readonly tenant: Tenant;
  readonly tenantId: string;
  readonly password: string;
  /** The first membership that may set up forms and move applications on. */
  readonly manager: string | undefined;
  /** Staff memberships by given and family name. */
  readonly staff: ReadonlyMap<string, string>;
}

/** An account with a password, a membership with `role` and a person: their ids. */
async function addAccount(
  writer: Omit<Writer, 'manager' | 'staff'>,
  [givenName, familyName]: readonly [string, string, ...unknown[]],
  email: string,
  role: Role,
): Promise<{ membership: string; person: string }> {
  const { insert, tenantId, password } = writer;
  const userId = await insert('auth.user', {
    name: `${givenName} ${familyName}`,
    email,
    email_verified: true,
  });
  await insert('auth.account', {
    user_id: userId,
    account_id: userId,
    provider_id: 'credential',
    password: hashPassword(password),
  });
  const membership = await insert('app.membership', {
    tenant_id: tenantId,
    user_id: userId,
    roles: [role],
  });
  const person = await insert('party.party', { tenant_id: tenantId, kind: 'person' });
  await insert('party.person', {
    tenant_id: tenantId,
    id: person,
    given_name: givenName,
    family_name: familyName,
    email,
    user_id: userId,
  });
  return { membership, person };
}

async function writeTenant(
  client: pg.ClientBase,
  tenant: Tenant,
  password: string,
): Promise<SeededTenant> {
  const tenantId = randomUUID();
  const rows: Record<string, string[]> = {};
  const insert = inserter(client, rows);

  // nosemgrep: tps-tenant-setting-only-in-tenant-context -- the seed runs as migrator against a checked local development database, setting each new tenant transaction-locally (ADR 0003)
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantId]);
  await insert('app.tenant', { id: tenantId, slug: tenant.slug, name: tenant.name });
  const writer = { client, insert, tenant, tenantId, password };
  let settingsManager: string | undefined;
  let manager: string | undefined;
  const staff = new Map<string, string>();
  for (const member of tenant.staff) {
    const role = member[2];
    const { membership } = await addAccount(writer, member, emailOf(tenant, member), role);
    staff.set(`${member[0]} ${member[1]}`, membership);
    const granted = permissionsFor([role], 'console');
    if (granted.includes('platform.settings.manage')) settingsManager ??= membership;
    if (MANAGER.every((permission) => granted.includes(permission))) manager ??= membership;
  }
  if (tenant.theme) {
    await insert('app.tenant_theme', {
      tenant_id: tenantId,
      brand_colour: tenant.theme.brandColour,
      preset: tenant.theme.preset,
      updated_by: settingsManager,
    });
  }
  for (const programme of tenant.programmes ?? []) {
    await writeProgramme({ ...writer, manager, staff }, programme);
  }
  return { id: tenantId, slug: tenant.slug, rows };
}

/** The instant that a wall-clock time names in a time zone, as PostgreSQL reads it. */
async function instant(client: pg.ClientBase, local: string, zone: string): Promise<Date> {
  const { rows } = await client.query<{ at: Date }>('SELECT $1::timestamp AT TIME ZONE $2 AS at', [
    local,
    zone,
  ]);
  const at = rows[0]?.at;
  if (!at) throw new Error(`${local} in ${zone} is not a time.`);
  return at;
}

async function writeProgramme(writer: Writer, programme: Programme): Promise<void> {
  const { client, insert, tenantId } = writer;
  const { title, summary, description, status } = programme;
  const programmeId = await insert('grants.programme', {
    tenant_id: tenantId,
    title,
    summary,
    description,
    status,
  });
  for (const [outcome, { subject, body }] of Object.entries(programme.templates)) {
    await insert('grants.email_template_version', {
      tenant_id: tenantId,
      programme_id: programmeId,
      outcome,
      version: 1,
      subject,
      body,
    });
  }
  for (const round of programme.rounds) {
    const roundId = await insert('grants.round', {
      tenant_id: tenantId,
      programme_id: programmeId,
      title: round.title,
      opens_at: await instant(client, round.opensAt, round.timezone),
      closes_at: await instant(client, round.closesAt, round.timezone),
      timezone: round.timezone,
      budget_minor: round.budgetMinor,
      award_min_minor: round.awardMinMinor,
      award_max_minor: round.awardMaxMinor,
      late_policy: round.latePolicy,
    });
    const stages: string[] = [];
    const criteria: string[][] = [];
    for (const [stageIndex, stage] of round.stages.entries()) {
      const stageId = await insert('grants.stage', {
        tenant_id: tenantId,
        round_id: roundId,
        name: stage.name,
        position: stageIndex + 1,
      });
      stages.push(stageId);
      const stageCriteria: string[] = [];
      criteria.push(stageCriteria);
      for (const [index, { label, guidance, weight }] of (stage.criteria ?? []).entries()) {
        const criterionId = await insert('grants.rubric_criterion', {
          tenant_id: tenantId,
          stage_id: stageId,
          label,
          guidance,
          weight,
          position: index + 1,
        });
        stageCriteria.push(criterionId);
      }
    }
    if (round.form !== undefined) {
      await writeApplications(writer, round, { id: roundId, stages, criteria });
    }
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** What writing a round's applications needs of the round as written. */
interface WrittenRound {
  readonly id: string;
  readonly stages: readonly string[];
  /** Each stage's criteria, in order. */
  readonly criteria: readonly (readonly string[])[];
}

/** Publish `round`'s form, fill its reviewer pool, then write its applications. */
async function writeApplications(
  writer: Writer,
  round: Round,
  written: WrittenRound,
): Promise<void> {
  const { client, insert, tenant, tenantId, manager } = writer;
  const parsed = parseDefinition(round.form);
  if (!parsed.success) throw new Error(`The form for ${round.title} is not a valid form.`);
  if (manager === undefined) throw new Error(`${tenant.name} needs a programme manager.`);
  const at = (local: string) => instant(client, local, round.timezone);
  const opens = await at(round.opensAt);
  const closes = await at(round.closesAt);
  const formVersion = await insert('grants.form_version', {
    tenant_id: tenantId,
    round_id: written.id,
    version: 1,
    status: 'published',
    definition: parsed.data,
    published_at: new Date(opens.getTime() - DAY),
    published_by: manager,
  });
  for (const name of round.reviewers ?? []) {
    await insert('grants.reviewer', {
      tenant_id: tenantId,
      round_id: written.id,
      membership_id: staffMember(writer, name),
      added_at: closes,
      added_by: manager,
    });
  }

  for (const application of round.applications ?? []) {
    const { applicant, organisation, answers } = application;
    const reached = round.stages.findIndex(({ name }) => name === application.stage);
    const stageId = written.stages[reached];
    if (stageId === undefined) throw new Error(`${round.title} has no stage ${application.stage}.`);
    const eligibility = checkEligibility(parsed.data, answers);
    if (eligibility.status === 'incomplete') {
      throw new Error(
        `An application to ${round.title} leaves an eligibility question unanswered.`,
      );
    }
    const own = await addAccount(
      writer,
      applicant,
      applicantEmailOf(tenant, applicant),
      'applicant',
    );
    const organisationId = await insert('party.party', {
      tenant_id: tenantId,
      kind: 'organisation',
    });
    await insert('party.organisation', {
      tenant_id: tenantId,
      id: organisationId,
      name: organisation.name,
      legal_form: organisation.legalForm,
      address_line1: organisation.addressLine1,
      address_town: organisation.town,
      address_postcode: organisation.postcode,
    });
    await insert('party.relationship', {
      tenant_id: tenantId,
      type: 'contact_for',
      subject_id: own.person,
      subject_kind: 'person',
      object_id: organisationId,
      object_kind: 'organisation',
    });

    const startedAt = await at(application.startedAt);
    const submittedAt = await at(application.submittedAt);
    const { withdrawnAt } = application;
    const applicationId = await insert('grants.application', {
      tenant_id: tenantId,
      round_id: written.id,
      form_version_id: formVersion,
      applicant_person_id: own.person,
      organisation_id: organisationId,
      status: withdrawnAt === undefined ? 'submitted' : 'withdrawn',
      answers,
      stage_id: stageId,
      submitted_at: submittedAt,
      submitted_late: submittedAt > closes,
      withdrawn_at: withdrawnAt === undefined ? null : await at(withdrawnAt),
      created_at: startedAt,
      created_by: own.membership,
      updated_by: own.membership,
    });
    await insert('grants.eligibility_result', {
      tenant_id: tenantId,
      application_id: applicationId,
      form_version_id: formVersion,
      outcome: eligibility.status,
      stopping_field_id: eligibility.status === 'stopped' ? eligibility.fieldId : null,
      checked_at: startedAt,
      checked_by: own.membership,
    });
    for (let stage = 0; stage <= reached; stage += 1) {
      await insert('grants.stage_transition', {
        tenant_id: tenantId,
        round_id: written.id,
        application_id: applicationId,
        from_stage_id: stage === 0 ? null : written.stages[stage - 1],
        to_stage_id: written.stages[stage],
        moved_at: stage === 0 ? submittedAt : new Date(closes.getTime() + stage * DAY),
        moved_by: stage === 0 ? own.membership : manager,
      });
    }
    const dayAfter = new Date(closes.getTime() + (reached + 1) * DAY);
    for (const review of application.reviews ?? []) {
      await writeReview(writer, review, {
        round: written.id,
        application: applicationId,
        stage: stageId,
        criteria: written.criteria[reached] ?? [],
        assignedAt: dayAfter,
      });
    }
    const { decision } = application;
    if (decision) {
      const amount = decision.outcome === 'accepted' ? decision.amountMinor : null;
      await insert('grants.decision', {
        tenant_id: tenantId,
        application_id: applicationId,
        outcome: decision.outcome,
        amount_minor: amount,
        currency: amount === null ? null : 'GBP',
        recorded_at: dayAfter,
        recorded_by: manager,
      });
    }
  }
}

function staffMember(
  { staff, tenant }: Writer,
  [givenName, familyName]: readonly string[],
): string {
  const membership = staff.get(`${givenName} ${familyName}`);
  if (membership === undefined) {
    throw new Error(`${tenant.name} has no staff member ${givenName} ${familyName}.`);
  }
  return membership;
}

/** Assign the reviewer, save their scores, and submit them if the review is submitted. */
async function writeReview(
  writer: Writer,
  review: Review,
  at: {
    readonly round: string;
    readonly application: string;
    readonly stage: string;
    readonly criteria: readonly string[];
    readonly assignedAt: Date;
  },
): Promise<void> {
  const { client, insert, tenantId } = writer;
  const complete = review.scores.length === at.criteria.length;
  if (review.scores.length > at.criteria.length || (review.submitted && !complete)) {
    throw new Error('A review scores at most every criterion, and a submitted one all of them.');
  }
  const assignmentId = await insert('grants.assignment', {
    tenant_id: tenantId,
    round_id: at.round,
    application_id: at.application,
    reviewer_membership_id: staffMember(writer, review.reviewer),
    stage_id: at.stage,
    created_at: at.assignedAt,
  });
  for (const [index, [score, comment]] of review.scores.entries()) {
    await insert('grants.score', {
      tenant_id: tenantId,
      assignment_id: assignmentId,
      stage_id: at.stage,
      criterion_id: at.criteria[index],
      score,
      comment,
    });
  }
  if (review.submitted) {
    await client.query("UPDATE grants.assignment SET status = 'submitted' WHERE id = $1", [
      assignmentId,
    ]);
  }
}
