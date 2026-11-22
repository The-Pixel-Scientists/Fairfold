// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writing the volume scenario: the tenant as any scenario is written, then
// its organisations, people and applications in batches of many rows per
// statement, all in one transaction with the tenant set (scenario.ts). Ids
// are made here, so rows can name each other before they are sent. Every
// applicant's account has the same Argon2id hash of the seed password, made
// once, since hashing 3,000 times would take minutes; staff each get their
// own. Assessments are submitted, and decisions released, by updates, so the
// database's own triggers set those times.

import { randomUUID } from 'node:crypto';

import { checkEligibility, parseDefinition } from '@pixel-scientists/domain/forms';
import { permissionsFor } from '@pixel-scientists/domain/platform';
import type pg from 'pg';

import { comments } from './names.ts';
import { hashPassword, MANAGER, writeTenant, type SeededTenant, type Tenant } from './scenario.ts';
import { generateVolume, VOLUME_ROUNDS, volumeTenant } from './volume.ts';

type Row = Readonly<Record<string, unknown>>;

/** Parameters per statement, well inside PostgreSQL's 65,535. */
const PARAMETERS = 30_000;

const quoted = (client: pg.ClientBase, table: string) =>
  table
    .split('.')
    .map((part) => client.escapeIdentifier(part))
    .join('.');

/** Insert `rows`, which all have the same columns and an id, keeping the ids under `table`. */
async function insertRows(
  client: pg.ClientBase,
  table: string,
  rows: readonly Row[],
  ids: Record<string, string[]>,
): Promise<void> {
  const [first] = rows;
  if (first === undefined) return;
  const columns = Object.keys(first);
  const name = quoted(client, table);
  const list = columns.map((column) => client.escapeIdentifier(column)).join(', ');
  const size = Math.floor(PARAMETERS / columns.length);
  for (let start = 0; start < rows.length; start += size) {
    const batch = rows.slice(start, start + size);
    const tuples = batch.map(
      (_, row) =>
        `(${columns.map((_, column) => `$${String(row * columns.length + column + 1)}`).join(', ')})`,
    );
    await client.query(
      `INSERT INTO ${name} (${list}) VALUES ${tuples.join(', ')}`,
      batch.flatMap((row) => columns.map((column) => row[column])),
    );
  }
  (ids[table] ??= []).push(...rows.map((row) => String(row['id'])));
}

/** The nth id written to `table`, which writeTenant() writes in the scenario's order. */
function nth(ids: Readonly<Record<string, readonly string[]>>, table: string, index: number) {
  const id = ids[table]?.[index];
  if (id === undefined) throw new Error(`The volume tenant has no ${table} row ${String(index)}.`);
  return id;
}

/** Write the volume scenario through `client`, connected as migrator, in one transaction. */
export async function writeVolume(
  client: pg.ClientBase,
  password: string,
  tenant: Tenant = volumeTenant,
): Promise<SeededTenant> {
  let seeded: SeededTenant;
  await client.query('BEGIN');
  try {
    const shell = await writeTenant(client, tenant, password);
    const ids: Record<string, string[]> = Object.fromEntries(
      Object.entries(shell.rows).map(([table, list]) => [table, [...list]]),
    );
    await writeData(client, tenant, shell.id, ids, password);
    await client.query('COMMIT');
    seeded = { ...shell, rows: ids };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  // Planner statistics for the new rows, which autovacuum would gather later.
  for (const table of Object.keys(seeded.rows))
    await client.query(`ANALYZE ${quoted(client, table)}`);
  return seeded;
}

async function writeData(
  client: pg.ClientBase,
  tenant: Tenant,
  tenantId: string,
  ids: Record<string, string[]>,
  password: string,
): Promise<void> {
  const insert = (table: string, rows: readonly Row[]) => insertRows(client, table, rows, ids);
  const volume = generateVolume(tenant.slug);
  // The first member who may move applications on, as writeTenant() picks them.
  const manager = nth(
    ids,
    'app.membership',
    tenant.staff.findIndex(([, , role]) => {
      const granted = permissionsFor([role], 'console');
      return MANAGER.every((permission) => granted.includes(permission));
    }),
  );
  const rounds = (tenant.programmes ?? []).flatMap(({ rounds: list }) => list);
  if (rounds.length !== VOLUME_ROUNDS) throw new Error('The volume tenant has the wrong rounds.');
  const roundIds = Array.from({ length: VOLUME_ROUNDS }, (_, r) => nth(ids, 'grants.round', r));
  // Each round has its stages in order and three criteria on Review, and a published form.
  const stage = (r: number, s: number) => nth(ids, 'grants.stage', r * 3 + s);
  const criterion = (r: number, c: number) => nth(ids, 'grants.rubric_criterion', r * 3 + c);
  const forms = rounds.map((round) => {
    const parsed = parseDefinition(round.form);
    if (!parsed.success) throw new Error(`The form for ${round.title} is not a valid form.`);
    return parsed.data;
  });
  const staffIndex = new Map(
    tenant.staff.map(([given, family], index) => [`${given} ${family}`, index]),
  );
  const pool = rounds.map((round) =>
    (round.reviewers ?? []).map(([given, family]) =>
      nth(ids, 'app.membership', staffIndex.get(`${given} ${family}`) ?? -1),
    ),
  );
  const { rows: times } = await client.query<{ id: string; opens_at: Date; closes_at: Date }>(
    'SELECT id, opens_at, closes_at FROM grants.round WHERE id = ANY($1::uuid[])',
    [roundIds],
  );
  const timeOf = new Map(times.map((row) => [row.id, row]));

  // People: an account, an applicant membership, a party and a person each.
  const hash = hashPassword(password);
  const people = volume.people.map((person) => ({
    person,
    user: randomUUID(),
    membership: randomUUID(),
    party: randomUUID(),
  }));
  await insert(
    'auth.user',
    people.map(({ person, user }) => ({
      id: user,
      name: `${person.givenName} ${person.familyName}`,
      email: person.email,
      email_verified: true,
    })),
  );
  await insert(
    'auth.account',
    people.map(({ user }) => ({
      id: randomUUID(),
      user_id: user,
      account_id: user,
      provider_id: 'credential',
      password: hash,
    })),
  );
  await insert(
    'app.membership',
    people.map(({ user, membership }) => ({
      id: membership,
      tenant_id: tenantId,
      user_id: user,
      roles: ['applicant'],
    })),
  );
  const organisations = volume.organisations.map((organisation) => ({
    organisation,
    party: randomUUID(),
  }));
  await insert('party.party', [
    ...people.map(({ party }) => ({ id: party, tenant_id: tenantId, kind: 'person' })),
    ...organisations.map(({ party }) => ({ id: party, tenant_id: tenantId, kind: 'organisation' })),
  ]);
  await insert(
    'party.person',
    people.map(({ person, user, party }) => ({
      id: party,
      tenant_id: tenantId,
      given_name: person.givenName,
      family_name: person.familyName,
      email: person.email,
      phone: person.phone,
      user_id: user,
    })),
  );
  await insert(
    'party.organisation',
    organisations.map(({ organisation, party }) => ({
      id: party,
      tenant_id: tenantId,
      name: organisation.name,
      legal_form: organisation.legalForm,
      address_line1: organisation.addressLine1,
      address_town: organisation.town,
      address_postcode: organisation.postcode,
    })),
  );
  await insert(
    'party.organisation_identifier',
    organisations.flatMap(({ organisation, party }) =>
      organisation.identifiers.map(({ scheme, identifier }) => ({
        id: randomUUID(),
        tenant_id: tenantId,
        organisation_id: party,
        scheme,
        identifier,
      })),
    ),
  );
  await insert(
    'party.relationship',
    people.flatMap(({ person, party }) =>
      person.contactFor.map((index) => ({
        id: randomUUID(),
        tenant_id: tenantId,
        type: 'contact_for',
        subject_id: party,
        subject_kind: 'person',
        object_id: organisations[index]?.party,
        object_kind: 'organisation',
      })),
    ),
  );

  // Applications, with their eligibility checks, stage history, assessments and decisions.
  const applications: Row[] = [];
  const checks: Row[] = [];
  const moves: Row[] = [];
  const assignments: Row[] = [];
  const scores: Row[] = [];
  const submittedAssignments: string[] = [];
  const decisions: Row[] = [];
  const released: string[] = [];
  for (const application of volume.applications) {
    const roundId = roundIds[application.round] ?? '';
    const time = timeOf.get(roundId);
    const form = forms[application.round];
    const applicant = people[application.applicant];
    const organisation = organisations[application.organisation];
    if (!time || !form || !applicant || !organisation)
      throw new Error('A volume application names nothing.');
    const at = (after: number | null) =>
      after === null ? null : new Date(time.opens_at.getTime() + after);
    const id = randomUUID();
    const submittedAt = at(application.submittedAfter);
    const startedAt = at(application.startedAfter) ?? time.opens_at;
    const reached = application.stage;
    applications.push({
      id,
      tenant_id: tenantId,
      round_id: roundId,
      form_version_id: nth(ids, 'grants.form_version', application.round),
      applicant_person_id: applicant.party,
      organisation_id: organisation.party,
      status: application.status,
      answers: JSON.stringify(application.answers),
      stage_id: reached === null ? null : stage(application.round, reached),
      submitted_at: submittedAt,
      submitted_late: submittedAt !== null && submittedAt > time.closes_at,
      withdrawn_at: at(application.withdrawnAfter),
      created_at: startedAt,
      updated_at: submittedAt ?? startedAt,
      created_by: applicant.membership,
      updated_by: applicant.membership,
    });
    const eligibility = checkEligibility(form, application.answers);
    checks.push({
      id: randomUUID(),
      tenant_id: tenantId,
      application_id: id,
      form_version_id: nth(ids, 'grants.form_version', application.round),
      outcome: eligibility.status,
      stopping_field_id: eligibility.status === 'stopped' ? eligibility.fieldId : null,
      checked_at: startedAt,
      checked_by: applicant.membership,
    });
    if (reached === null || submittedAt === null) continue;
    for (let s = 0; s <= reached; s += 1) {
      moves.push({
        id: randomUUID(),
        tenant_id: tenantId,
        round_id: roundId,
        application_id: id,
        from_stage_id: s === 0 ? null : stage(application.round, s - 1),
        to_stage_id: stage(application.round, s),
        moved_at: s === 0 ? submittedAt : new Date(time.closes_at.getTime() + s * 86_400_000),
        moved_by: s === 0 ? applicant.membership : manager,
      });
    }
    for (const review of application.reviews) {
      const assignment = randomUUID();
      assignments.push({
        id: assignment,
        tenant_id: tenantId,
        round_id: roundId,
        application_id: id,
        reviewer_membership_id: pool[application.round]?.[review.reviewer],
        stage_id: stage(application.round, 1),
        created_at: new Date(time.closes_at.getTime() + 2 * 86_400_000),
      });
      review.scores.forEach((score, c) => {
        scores.push({
          id: randomUUID(),
          tenant_id: tenantId,
          assignment_id: assignment,
          stage_id: stage(application.round, 1),
          criterion_id: criterion(application.round, c),
          score,
          comment: comments[score - 1] ?? '',
        });
      });
      if (review.submitted) submittedAssignments.push(assignment);
    }
    if (application.decision) {
      const decision = randomUUID();
      const amount = application.decision.amountMinor;
      decisions.push({
        id: decision,
        tenant_id: tenantId,
        application_id: id,
        outcome: application.decision.outcome,
        amount_minor: amount,
        currency: amount === null ? null : 'GBP',
        recorded_at: new Date(time.closes_at.getTime() + 4 * 86_400_000),
        recorded_by: manager,
      });
      if (application.decision.released) released.push(decision);
    }
  }
  await insert('grants.application', applications);
  await insert('grants.eligibility_result', checks);
  await insert('grants.stage_transition', moves);
  await insert('grants.assignment', assignments);
  await insert('grants.score', scores);
  await client.query(
    "UPDATE grants.assignment SET status = 'submitted' WHERE id = ANY($1::uuid[])",
    [submittedAssignments],
  );
  await insert('grants.decision', decisions);
  await client.query('UPDATE grants.decision SET released_by = $1 WHERE id = ANY($2::uuid[])', [
    manager,
    released,
  ]);
}
