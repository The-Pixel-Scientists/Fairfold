// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The round routes' handlers. A round is entered on the wall clock of the
// tenant's time zone, stored as instants, and answered on the wall clock of
// the zone it was saved in. A new round starts with the default stages.

import { messages } from '@pixel-scientists/domain/platform';

import {
  configDiff,
  defaultStageNames,
  type Round,
  type RoundInput,
  type RoundList,
  type Stage,
} from '../../contracts/index.ts';
import { recordConfig } from './change.ts';
import type { Args, GrantsDependencies, ProgrammeParams, RoundParams } from './context.ts';
import { programmeExists, readRound, readRounds } from './read.ts';
import { grantsDb, type Tx } from './tables.ts';
import { instantAt } from './time.ts';
import { columnChanges, roundColumns, roundValues, stageValues } from './values.ts';

interface Times {
  readonly zone: string;
  readonly opens: Date;
  readonly closes: Date;
}

export function roundHandlers(deps: GrantsDependencies) {
  /** The round's times as instants in the tenant's zone, or a 400 naming the time that zone never shows. */
  async function instants(
    tx: Tx,
    tenant: string,
    { opensAt, closesAt }: RoundInput,
  ): Promise<Times> {
    const zone = await deps.tenantTimeZone(tx, tenant);
    const opens = instantAt(zone, opensAt);
    const closes = instantAt(zone, closesAt);
    const problems = [
      ...(opens === null ? [{ field: 'body.opensAt', message: messages.enterValidDate }] : []),
      ...(closes === null ? [{ field: 'body.closesAt', message: messages.enterValidDate }] : []),
    ];
    if (opens === null || closes === null) {
      throw deps.refuse(400, messages.fixFields, problems);
    }
    return { zone, opens, closes };
  }

  const columns = (round: RoundInput, times: Times) => ({
    title: round.title,
    opens_at: times.opens,
    closes_at: times.closes,
    timezone: times.zone,
    budget_minor: round.budget.amountMinor,
    award_min_minor: round.awardMinimum.amountMinor,
    award_max_minor: round.awardMaximum.amountMinor,
    late_policy: round.latePolicy,
  });

  async function listRounds({ tx, input }: Args<ProgrammeParams>): Promise<RoundList> {
    const { programmeId } = input.params;
    if (!(await programmeExists(tx, programmeId))) throw deps.notFound();
    return { rounds: await readRounds(tx, programmeId) };
  }

  async function createRound({
    tx,
    context,
    input,
  }: Args<ProgrammeParams & { body: RoundInput }>): Promise<Round> {
    const { programmeId } = input.params;
    if (!(await programmeExists(tx, programmeId))) throw deps.notFound();
    const times = await instants(tx, context.session.tenant, input.body);
    const db = grantsDb(tx);
    const actor = context.membership.id;
    const { id } = await db
      .insertInto('grants.round')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        programme_id: programmeId,
        ...columns(input.body, times),
        created_by: actor,
        updated_by: actor,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const created = await db
      .insertInto('grants.stage')
      .values((eb) =>
        defaultStageNames.map((name, index) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          round_id: id,
          name,
          position: index + 1,
          created_by: actor,
          updated_by: actor,
        })),
      )
      .returning(['id', 'name', 'position'])
      .execute();

    const round = { id, programmeId, ...input.body, timeZone: times.zone };
    const stages: Stage[] = created
      .map((stage) => ({ ...stage, criteria: [] }))
      .sort((a, b) => a.position - b.position);
    const diff = configDiff(null, { ...roundValues(round), ...stageValues(stages) });
    await recordConfig(deps, tx, context, 'grants.round', id, diff);
    await context.audit.record({
      action: 'grants.round.created',
      entityId: id,
      changes: columnChanges('grants.round', roundColumns, diff),
    });
    return round;
  }

  async function getRound({ tx, input }: Args<RoundParams>): Promise<Round> {
    return (await readRound(tx, input.params.roundId)) ?? Promise.reject(deps.notFound());
  }

  async function updateRound({
    tx,
    context,
    input,
  }: Args<RoundParams & { body: RoundInput }>): Promise<Round> {
    const { roundId } = input.params;
    const found = await readRound(tx, roundId, true);
    if (found === undefined) throw deps.notFound();
    const times = await instants(tx, context.session.tenant, input.body);

    const round = { ...found, ...input.body, timeZone: times.zone };
    const diff = configDiff(roundValues(found), roundValues(round));
    if (diff.length > 0) {
      await grantsDb(tx)
        .updateTable('grants.round')
        .set({ ...columns(input.body, times), updated_by: context.membership.id })
        .where('id', '=', roundId)
        .execute();
      await recordConfig(deps, tx, context, 'grants.round', roundId, diff);
      await context.audit.record({
        action: 'grants.round.updated',
        entityId: roundId,
        changes: columnChanges('grants.round', roundColumns, diff),
      });
    }
    return round;
  }

  return { listRounds, createRound, getRound, updateRound };
}
