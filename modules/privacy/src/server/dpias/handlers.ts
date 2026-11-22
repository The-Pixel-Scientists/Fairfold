// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The DPIA register's handlers. Screening answers are keyed by the stable id
// of the question and risks by their own id (rule 7), and the contracts have
// already checked them and their size. A DPIA's text is personal or special
// category and never goes into an audit event. Signing off is its own step
// by the session's member, at a time the database sets (rule 9). A PUT is
// how a signed-off DPIA is reopened: it names a draft or in-review status,
// and the sign-off is cleared with the change.

import {
  calendarDateIn,
  type Dpia,
  type DpiaInput,
  type DpiaUpdate,
} from '../../contracts/index.ts';
import {
  changedColumns,
  failedCheck,
  isRefusedByState,
  iso,
  privacyDb,
  refusals,
  type Args,
  type PrivacyDb,
  type PrivacyDependencies,
  type ReplayArgs,
  type Tx,
} from '../context.ts';
import { decodeCursor, PAGE_SIZE, toPage } from '../page.ts';

export interface DpiaParams {
  readonly params: { readonly dpiaId: string };
}

const TABLE = 'privacy.dpia';
const SIGNED = ['signed_off', 'review_due'];

const selectDpias = (db: PrivacyDb) =>
  db
    .selectFrom('privacy.dpia as d')
    .select((eb) => [
      'd.id',
      'd.title',
      'd.status',
      'd.screening',
      'd.risks',
      'd.dpo_advice',
      'd.signed_off_by',
      'd.signed_off_at',
      eb.cast<string | null>('d.review_on', 'text').as('review_on'),
      'd.created_at',
      'd.updated_at',
    ]);

type DpiaRow = Awaited<ReturnType<ReturnType<typeof selectDpias>['executeTakeFirstOrThrow']>>;

/** Fields the DPIA's size caps in the database refuse, with the words the member sees. */
const tooLarge = (error: unknown): boolean =>
  failedCheck(error, 'dpia_screening_object') || failedCheck(error, 'dpia_risks_array');

/** The same JSON whatever the order of an object's keys, which jsonb does not keep. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : item,
  );

export function dpiaHandlers(deps: PrivacyDependencies) {
  const linkedActivities = async (tx: Tx, dpiaId: string): Promise<string[]> =>
    (
      await privacyDb(tx)
        .selectFrom('privacy.dpia_processing_activity')
        .select('processing_activity_id')
        .where('dpia_id', '=', dpiaId)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    ).map((row) => row.processing_activity_id);

  async function readDpia(tx: Tx, dpiaId: string, lock = false): Promise<DpiaRow> {
    const query = selectDpias(privacyDb(tx)).where('d.id', '=', dpiaId);
    const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return row;
  }

  async function toDpia(tx: Tx, row: DpiaRow): Promise<Dpia> {
    return {
      id: row.id,
      title: row.title,
      status: row.status as Dpia['status'],
      processingActivityIds: await linkedActivities(tx, row.id),
      screening: row.screening as Dpia['screening'],
      risks: row.risks as Dpia['risks'],
      dpoAdvice: row.dpo_advice,
      signOff:
        row.signed_off_by === null || row.signed_off_at === null || row.review_on === null
          ? null
          : {
              membershipId: row.signed_off_by,
              signedOffAt: iso(row.signed_off_at),
              reviewOn: row.review_on,
            },
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  /** Refuses an id that is not one of this tenant's processing activities. */
  async function checkActivities(tx: Tx, ids: readonly string[]) {
    if (ids.length === 0) return;
    const found = await privacyDb(tx)
      .selectFrom('privacy.processing_activity')
      .select('id')
      .where('id', 'in', ids)
      .execute();
    if (found.length !== ids.length) {
      const message = refusals.activities;
      throw deps.refuse(400, message, [{ field: 'body.processingActivityIds', message }]);
    }
  }

  /** Links and unlinks to match `wanted`, and answers whether anything changed. */
  async function setActivities(tx: Tx, actor: string, dpiaId: string, wanted: readonly string[]) {
    const db = privacyDb(tx);
    const current = await linkedActivities(tx, dpiaId);
    const added = wanted.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !wanted.includes(id));
    if (added.length > 0) {
      await db
        .insertInto('privacy.dpia_processing_activity')
        .values((eb) =>
          added.map((processingActivityId) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            dpia_id: dpiaId,
            processing_activity_id: processingActivityId,
            created_by: actor,
          })),
        )
        .execute();
    }
    if (removed.length > 0) {
      await db
        .deleteFrom('privacy.dpia_processing_activity')
        .where('dpia_id', '=', dpiaId)
        .where('processing_activity_id', 'in', removed)
        .execute();
    }
    return added.length + removed.length > 0;
  }

  async function listDpias({ tx, input }: Args<{ query: { status?: string; cursor?: string } }>) {
    const { status, cursor } = input.query;
    const offset = decodeCursor(cursor);
    if (offset === null) throw deps.refuse(400, refusals.page);
    let query = selectDpias(privacyDb(tx));
    if (status !== undefined) query = query.where('d.status', '=', status);
    const rows = await query
      .orderBy('d.updated_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(PAGE_SIZE + 1)
      .offset(offset)
      .execute();
    const { items, nextCursor } = toPage(rows, offset);
    return {
      dpias: items.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status as Dpia['status'],
        updatedAt: iso(row.updated_at),
        reviewOn: row.review_on,
      })),
      nextCursor,
    };
  }

  async function createDpia({ tx, context, input }: Args<{ body: DpiaInput }>): Promise<Dpia> {
    const { title, processingActivityIds, screening, risks, dpoAdvice } = input.body;
    await checkActivities(tx, processingActivityIds);
    const actor = context.membership.id;
    let id: string;
    try {
      ({ id } = await privacyDb(tx)
        .insertInto(TABLE)
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          title,
          screening: JSON.stringify(screening),
          risks: JSON.stringify(risks),
          dpo_advice: dpoAdvice,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      if (tooLarge(error)) throw deps.refuse(400, refusals.tooLarge);
      throw error;
    }
    await setActivities(tx, actor, id, processingActivityIds);
    await context.audit.record({
      action: 'privacy.dpia.created',
      entityId: id,
      changes: {
        [`${TABLE}.title`]: { after: title },
        [`${TABLE}.status`]: { after: 'draft' },
      },
    });
    return toDpia(tx, await readDpia(tx, id));
  }

  async function getDpia({ tx, context, input }: Args<DpiaParams>): Promise<Dpia> {
    const dpia = await toDpia(tx, await readDpia(tx, input.params.dpiaId));
    await context.audit.read({ action: 'privacy.dpia.viewed', entityId: dpia.id });
    return dpia;
  }

  async function updateDpia({
    tx,
    context,
    input,
  }: Args<DpiaParams & { body: DpiaUpdate }>): Promise<Dpia> {
    const { dpiaId } = input.params;
    const { title, status, processingActivityIds, screening, risks, dpoAdvice } = input.body;
    const found = await readDpia(tx, dpiaId, true);
    await checkActivities(tx, processingActivityIds);

    const actor = context.membership.id;
    const reopened = SIGNED.includes(found.status);
    try {
      await privacyDb(tx)
        .updateTable(TABLE)
        .set({
          title,
          status,
          screening: JSON.stringify(screening),
          risks: JSON.stringify(risks),
          dpo_advice: dpoAdvice,
          ...(reopened ? { signed_off_by: null, review_on: null } : {}),
          updated_by: actor,
        })
        .where('id', '=', dpiaId)
        .execute();
      const relinked = await setActivities(tx, actor, dpiaId, processingActivityIds);
      const changes = {
        ...changedColumns(
          TABLE,
          { title: found.title, status: found.status },
          { title, status },
          ['status'],
          ['title'],
        ),
        ...(canonical(found.screening) === canonical(screening)
          ? {}
          : { [`${TABLE}.screening`]: {} }),
        ...(canonical(found.risks) === canonical(risks) ? {} : { [`${TABLE}.risks`]: {} }),
        ...(found.dpo_advice === dpoAdvice ? {} : { [`${TABLE}.dpo_advice`]: {} }),
        ...(relinked ? { 'privacy.dpia_processing_activity.processing_activity_id': {} } : {}),
        ...(reopened ? { [`${TABLE}.signed_off_by`]: { before: found.signed_off_by } } : {}),
      };
      if (Object.keys(changes).length > 0) {
        await context.audit.record({ action: 'privacy.dpia.updated', entityId: dpiaId, changes });
      }
    } catch (error) {
      if (tooLarge(error)) throw deps.refuse(400, refusals.tooLarge);
      if (isRefusedByState(error)) throw deps.refuse(409, refusals.alreadySignedOff);
      throw error;
    }
    return toDpia(tx, await readDpia(tx, dpiaId));
  }

  async function signOffDpia({
    tx,
    context,
    input,
  }: Args<DpiaParams & { body: { readonly reviewOn: string } }>): Promise<Dpia> {
    const { dpiaId } = input.params;
    const { reviewOn } = input.body;
    const found = await readDpia(tx, dpiaId, true);
    if (SIGNED.includes(found.status)) throw deps.refuse(409, refusals.alreadySignedOff);
    const today = calendarDateIn(
      iso(deps.now()),
      await deps.tenantTimeZone(tx, context.session.tenant),
    );
    if (reviewOn <= today) {
      const message = refusals.reviewDate;
      throw deps.refuse(400, message, [{ field: 'body.reviewOn', message }]);
    }

    await privacyDb(tx)
      .updateTable(TABLE)
      .set({
        status: 'signed_off',
        signed_off_by: context.membership.id,
        review_on: reviewOn,
        updated_by: context.membership.id,
      })
      .where('id', '=', dpiaId)
      .execute();
    await context.audit.record({
      action: 'privacy.dpia.signed_off',
      entityId: dpiaId,
      changes: {
        [`${TABLE}.status`]: { before: found.status, after: 'signed_off' },
        [`${TABLE}.review_on`]: { after: reviewOn },
      },
    });
    return toDpia(tx, await readDpia(tx, dpiaId));
  }

  /** Answers a replayed create with the DPIA as it reads now, without a view event. */
  const replayDpia = ({ tx, input, id }: ReplayArgs<Partial<DpiaParams>>) => {
    const dpiaId = id ?? input.params?.dpiaId;
    return dpiaId === undefined
      ? Promise.reject(deps.notFound())
      : readDpia(tx, dpiaId).then((row) => toDpia(tx, row));
  };

  return { listDpias, createDpia, getDpia, updateDpia, signOffDpia, replayDpia };
}
