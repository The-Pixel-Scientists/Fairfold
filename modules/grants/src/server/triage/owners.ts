// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Setting or clearing the owner of submissions (E7), one or many, all or
// none. The owner is checked here, in the request's tenant transaction and
// on every write, to be an active member who may read applications (rule 6).
// Owners are triage data: nothing here changes a status, a stage or a decision.

import type { BulkOwnerInput, BulkTriageResult, OwnerAnswer } from '../../contracts/index.ts';
import { triageMessages } from '../../contracts/index.ts';
import { namesOf } from '../assessment/names.ts';
import type { Tx } from '../programme/tables.ts';
import type { TriageArgs, TriageContext, TriageDependencies } from './context.ts';
import { lockSubmissions } from './submissions.ts';
import { triageDb } from './tables.ts';

const OWNER = 'grants.application_owner.membership_id';

export function ownerHandlers(deps: TriageDependencies) {
  async function assign(
    tx: Tx,
    context: TriageContext,
    submissionIds: readonly string[],
    ownerId: string | null,
  ): Promise<number> {
    const ids = await lockSubmissions(tx, deps, submissionIds);
    if (
      ownerId !== null &&
      !(await deps.membersWith(tx, 'grants.applications.read')).includes(ownerId)
    ) {
      throw deps.refuse(400, triageMessages.ownerCannotView, [
        { field: 'body.ownerId', message: triageMessages.ownerCannotView },
      ]);
    }
    const db = triageDb(tx);
    const current = new Map(
      (
        await db
          .selectFrom('grants.application_owner')
          .select(['application_id', 'membership_id'])
          .where('application_id', 'in', ids)
          .execute()
      ).map((row) => [row.application_id, row.membership_id]),
    );
    const changing = ids.filter((id) => (current.get(id) ?? null) !== ownerId);
    if (changing.length === 0) return 0;

    if (ownerId === null) {
      await db
        .deleteFrom('grants.application_owner')
        .where('application_id', 'in', changing)
        .execute();
    } else {
      await db
        .insertInto('grants.application_owner')
        .values((eb) =>
          changing.map((id) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            application_id: id,
            membership_id: ownerId,
            assigned_by: context.membership.id,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'application_id']).doUpdateSet((eb) => ({
            membership_id: eb.ref('excluded.membership_id'),
            assigned_by: eb.ref('excluded.assigned_by'),
          })),
        )
        .execute();
    }
    for (const id of changing) {
      await context.audit.record({
        action: 'grants.application.owner_changed',
        entityId: id,
        changes: { [OWNER]: { before: current.get(id) ?? null, after: ownerId } },
      });
    }
    return changing.length;
  }

  async function setOwner({
    tx,
    context,
    input,
  }: TriageArgs<{
    params: { submissionId: string };
    body: { ownerId: string | null };
  }>): Promise<OwnerAnswer> {
    const { ownerId } = input.body;
    await assign(tx, context, [input.params.submissionId], ownerId);
    if (ownerId === null) return { owner: null };
    return {
      owner: { membershipId: ownerId, name: (await namesOf(tx, [ownerId])).get(ownerId) ?? null },
    };
  }

  async function setOwners({
    tx,
    context,
    input,
  }: TriageArgs<{ body: BulkOwnerInput }>): Promise<BulkTriageResult> {
    const { submissionIds, ownerId } = input.body;
    return { changed: await assign(tx, context, submissionIds, ownerId) };
  }

  return { setOwner, setOwners };
}
