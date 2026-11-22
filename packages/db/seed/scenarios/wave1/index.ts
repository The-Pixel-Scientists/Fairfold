// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scenario `wave1`: `configured`, then the three tenants in tenants.ts, each
// written by writeTenant() and then by every file in parts/ whose tool is in
// the tenant's list, in file name order, all in one transaction. Each part
// writes one tool's rows; a tool whose schema comes later adds its own file
// there. The data is fixed by hand, so every run writes the same rows under
// new ids. The seed prints how many rows it wrote of each table, and
// nothing else about them.
//
// writeTenant() switches on exactly each tenant's tools as the operator does
// when it makes a tenant, each with its configuration version and audit
// event, and leaves every other tool without a row, so off.

import { readdirSync } from 'node:fs';

import type pg from 'pg';

import { configured } from '../../configured.ts';
import { writeTenant, type Scenario, type SeededTenant } from '../../scenario.ts';
import type { Seed } from '../../seed.ts';
import { wave1Tenants } from './tenants.ts';
import { partWriter, requireTenant, type Part, type Wave1Tenant } from './write.ts';

const PARTS = new URL('./parts/', import.meta.url);

async function loadParts(): Promise<Part[]> {
  const files = readdirSync(PARTS)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
  const parts: Part[] = [];
  for (const file of files) {
    const { part } = (await import(new URL(file, PARTS).href)) as { part?: Part };
    if (typeof part?.write !== 'function') throw new Error(`parts/${file} exports no part.`);
    parts.push(part);
  }
  return parts;
}

/** Write `base`, then `tenants` with their tools' rows, through a migrator client in one transaction. */
export async function writeWave1(
  client: pg.ClientBase,
  password: string,
  base: Scenario,
  tenants: readonly Wave1Tenant[],
): Promise<SeededTenant[]> {
  const parts = await loadParts();
  await client.query('BEGIN');
  try {
    const seeded: SeededTenant[] = [];
    for (const tenant of base) seeded.push(await writeTenant(client, tenant, password));
    for (const tenant of tenants) {
      const shell = await writeTenant(client, tenant, password);
      const rows = Object.fromEntries(
        Object.entries(shell.rows).map(([table, ids]) => [table, [...ids]]),
      );
      await requireTenant(client, shell.id);
      const writer = partWriter(client, tenant, shell, rows);
      for (const part of parts) {
        if (tenant.tools.includes(part.tool)) await part.write(writer);
      }
      seeded.push({ ...shell, rows });
    }
    await client.query('COMMIT');
    return seeded;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** How many rows were written of each table, across every tenant. */
export function countLines(seeded: readonly SeededTenant[]): string[] {
  const totals = new Map<string, number>();
  for (const { rows } of seeded) {
    for (const [table, ids] of Object.entries(rows)) {
      totals.set(table, (totals.get(table) ?? 0) + ids.length);
    }
  }
  return ['', ...[...totals].map(([table, count]) => `  ${table}: ${String(count)}`)];
}

export const wave1: Seed = async (client, password) =>
  countLines(await writeWave1(client, password, configured, wave1Tenants));
