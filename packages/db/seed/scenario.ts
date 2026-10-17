// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a seed scenario holds, and how it is written. Every name, address and
// number in a scenario is synthetic. The seed connects as migrator, which
// forced row-level security binds like any app role (ADR 0003), so it sets
// each tenant in turn and writes that tenant's rows, all in one transaction.
// Actor columns stay null, as for anything the system does, except where the
// schema needs a member.

import { argon2Sync, randomBytes, randomUUID } from 'node:crypto';

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

async function writeTenant(
  client: pg.ClientBase,
  tenant: Tenant,
  password: string,
): Promise<SeededTenant> {
  const id = randomUUID();
  const rows: Record<string, string[]> = {};
  const insert = inserter(client, rows);

  // nosemgrep: tps-tenant-setting-only-in-tenant-context -- the seed runs as migrator against a checked local development database, setting each new tenant transaction-locally (ADR 0003)
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [id]);
  await insert('app.tenant', { id, slug: tenant.slug, name: tenant.name });
  let settingsManager: string | undefined;
  for (const member of tenant.staff) {
    const [givenName, familyName, role] = member;
    const email = emailOf(tenant, member);
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
      tenant_id: id,
      user_id: userId,
      roles: [role],
    });
    if (permissionsFor([role], 'console').includes('platform.settings.manage')) {
      settingsManager ??= membership;
    }
    const person = await insert('party.party', { tenant_id: id, kind: 'person' });
    await insert('party.person', {
      tenant_id: id,
      id: person,
      given_name: givenName,
      family_name: familyName,
      email,
      user_id: userId,
    });
  }
  if (tenant.theme) {
    await insert('app.tenant_theme', {
      tenant_id: id,
      brand_colour: tenant.theme.brandColour,
      preset: tenant.theme.preset,
      updated_by: settingsManager,
    });
  }
  for (const programme of tenant.programmes ?? []) {
    await writeProgramme(client, insert, id, programme);
  }
  return { id, slug: tenant.slug, rows };
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

async function writeProgramme(
  client: pg.ClientBase,
  insert: Insert,
  tenantId: string,
  programme: Programme,
): Promise<void> {
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
    for (const [stageIndex, stage] of round.stages.entries()) {
      const stageId = await insert('grants.stage', {
        tenant_id: tenantId,
        round_id: roundId,
        name: stage.name,
        position: stageIndex + 1,
      });
      for (const [index, { label, guidance, weight }] of (stage.criteria ?? []).entries()) {
        await insert('grants.rubric_criterion', {
          tenant_id: tenantId,
          stage_id: stageId,
          label,
          guidance,
          weight,
          position: index + 1,
        });
      }
    }
  }
}
