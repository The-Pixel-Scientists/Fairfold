// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breach log's handlers. Every answer carries the 72-hour clock from the
// contracts' breachClock(), read against the server's one clock. Nothing
// here contacts the ICO or a data subject, or decides a breach is notifiable
// (rule 9): a member records an assessment and, separately, that they told
// the ICO or the people affected. A breach's text is special category and
// never goes into an audit event, a log or a message.

import {
  breachClock,
  futureTimeProblem,
  icoNotificationProblem,
  privacyMessages,
  specialCategoryData,
  type notificationMethods,
  type AssessmentInput,
  type Breach,
  type BreachInput,
  type BreachUpdate,
  type DataCategory,
  type IcoNotificationInput,
} from '../../contracts/index.ts';
import {
  changedColumns,
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

export interface BreachParams {
  readonly params: { readonly breachId: string };
}

type Assessment = Breach['assessments'][number];
export interface SubjectNotificationInput {
  readonly notifiedAt: string;
  readonly method: (typeof notificationMethods)[number];
}

const TABLE = 'privacy.breach';
const TEXT = ['description', 'consequences', 'measures'] as const;

const selectBreaches = (db: PrivacyDb) => db.selectFrom('privacy.breach as b').selectAll('b');

type BreachRow = Awaited<ReturnType<ReturnType<typeof selectBreaches>['executeTakeFirstOrThrow']>>;

const toAssessment = (row: {
  id: string;
  risk_level: string;
  notify_ico: boolean;
  notify_subjects: boolean;
  rationale: string;
  assessed_by: string;
  created_at: Date;
}): Assessment => ({
  id: row.id,
  riskLevel: row.risk_level as Assessment['riskLevel'],
  notifyIco: row.notify_ico,
  notifySubjects: row.notify_subjects,
  rationale: row.rationale,
  assessedByMembershipId: row.assessed_by,
  assessedAt: iso(row.created_at),
});

const readAssessments = (tx: Tx, breachIds: readonly string[]) =>
  breachIds.length === 0
    ? Promise.resolve([])
    : privacyDb(tx)
        .selectFrom('privacy.breach_assessment as a')
        .selectAll('a')
        .where('a.breach_id', 'in', breachIds)
        .orderBy('a.created_at')
        .orderBy('a.id')
        .execute();

const clockOf = (row: BreachRow, now: Date) =>
  breachClock(
    iso(row.became_aware_at),
    row.ico_notified_at === null ? null : iso(row.ico_notified_at),
    iso(now),
  );

const isSpecial = (categories: readonly string[]) =>
  categories.some((category) => (specialCategoryData as readonly string[]).includes(category));

const count = (value: string | null): number | null => (value === null ? null : Number(value));

export function breachHandlers(deps: PrivacyDependencies) {
  const lockBreach = async (tx: Tx, breachId: string): Promise<BreachRow> => {
    const row = await selectBreaches(privacyDb(tx))
      .where('b.id', '=', breachId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return row;
  };

  async function readBreach(tx: Tx, breachId: string): Promise<Breach> {
    const row = await selectBreaches(privacyDb(tx)).where('b.id', '=', breachId).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    const assessments = await readAssessments(tx, [row.id]);
    return {
      id: row.id,
      becameAwareAt: iso(row.became_aware_at),
      discoveredAt: iso(row.discovered_at),
      description: row.description,
      dataCategories: row.data_categories as DataCategory[],
      specialCategory: isSpecial(row.data_categories),
      approximateSubjects: count(row.approx_subjects),
      approximateRecords: count(row.approx_records),
      likelyConsequences: row.consequences,
      measuresTaken: row.measures,
      clock: clockOf(row, deps.now()),
      assessments: assessments.map(toAssessment),
      icoNotification:
        row.ico_notified_at === null
          ? null
          : {
              notifiedAt: iso(row.ico_notified_at),
              reference: row.ico_reference ?? '',
              lateReason: row.ico_late_reason as NonNullable<
                Breach['icoNotification']
              >['lateReason'],
              recordedByMembershipId: row.ico_recorded_by ?? '',
              recordedAt: iso(row.ico_recorded_at ?? row.ico_notified_at),
            },
      subjectNotification:
        row.subjects_notified_at === null
          ? null
          : {
              notifiedAt: iso(row.subjects_notified_at),
              method: row.subjects_notice_method as SubjectNotificationInput['method'],
              recordedByMembershipId: row.subjects_recorded_by ?? '',
              recordedAt: iso(row.subjects_recorded_at ?? row.subjects_notified_at),
            },
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  /** A time after now is refused, naming the field. */
  function refuseFuture(fields: Readonly<Record<string, string>>) {
    const now = iso(deps.now());
    const errors = Object.entries(fields).flatMap(([field, time]) => {
      const message = futureTimeProblem(now, time);
      return message === null ? [] : [{ field: `body.${field}`, message }];
    });
    if (errors.length > 0) throw deps.refuse(400, privacyMessages.timeInFuture, errors);
  }

  async function listBreaches({ tx, input }: Args<{ query: { cursor?: string | undefined } }>) {
    const offset = decodeCursor(input.query.cursor);
    if (offset === null) throw deps.refuse(400, refusals.page);
    const rows = await selectBreaches(privacyDb(tx))
      .orderBy('b.became_aware_at', 'desc')
      .orderBy('b.id', 'desc')
      .limit(PAGE_SIZE + 1)
      .offset(offset)
      .execute();
    const { items, nextCursor } = toPage(rows, offset);
    const assessments = await readAssessments(
      tx,
      items.map((row) => row.id),
    );
    const now = deps.now();
    return {
      breaches: items.map((row) => ({
        id: row.id,
        becameAwareAt: iso(row.became_aware_at),
        dataCategories: row.data_categories as DataCategory[],
        specialCategory: isSpecial(row.data_categories),
        clock: clockOf(row, now),
        riskLevel:
          (assessments.findLast((assessment) => assessment.breach_id === row.id)?.risk_level as
            Assessment['riskLevel'] | undefined) ?? null,
        icoNotified: row.ico_notified_at !== null,
      })),
      nextCursor,
    };
  }

  async function createBreach({
    tx,
    context,
    input,
  }: Args<{ body: BreachInput }>): Promise<Breach> {
    const { becameAwareAt, discoveredAt, description, dataCategories } = input.body;
    refuseFuture({ becameAwareAt, discoveredAt });
    const actor = context.membership.id;
    const { id } = await privacyDb(tx)
      .insertInto(TABLE)
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        became_aware_at: becameAwareAt,
        discovered_at: discoveredAt,
        description,
        data_categories: dataCategories,
        approx_subjects: input.body.approximateSubjects,
        approx_records: input.body.approximateRecords,
        consequences: input.body.likelyConsequences,
        measures: input.body.measuresTaken,
        recorded_by: actor,
        updated_by: actor,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'privacy.breach.recorded',
      entityId: id,
      changes: {
        [`${TABLE}.became_aware_at`]: { after: becameAwareAt },
        [`${TABLE}.discovered_at`]: { after: discoveredAt },
        [`${TABLE}.data_categories`]: { after: dataCategories },
      },
    });
    return readBreach(tx, id);
  }

  async function getBreach({ tx, context, input }: Args<BreachParams>): Promise<Breach> {
    const breach = await readBreach(tx, input.params.breachId);
    await context.audit.read({ action: 'privacy.breach.viewed', entityId: breach.id });
    return breach;
  }

  async function updateBreach({
    tx,
    context,
    input,
  }: Args<BreachParams & { body: BreachUpdate }>): Promise<Breach> {
    const { breachId } = input.params;
    const body = input.body;
    refuseFuture({ discoveredAt: body.discoveredAt });
    const found = await lockBreach(tx, breachId);
    const changes = changedColumns(
      TABLE,
      {
        discovered_at: iso(found.discovered_at),
        description: found.description,
        data_categories: found.data_categories.join(),
        approx_subjects: count(found.approx_subjects),
        approx_records: count(found.approx_records),
        consequences: found.consequences,
        measures: found.measures,
      },
      {
        discovered_at: iso(new Date(body.discoveredAt)),
        description: body.description,
        data_categories: body.dataCategories.join(),
        approx_subjects: body.approximateSubjects,
        approx_records: body.approximateRecords,
        consequences: body.likelyConsequences,
        measures: body.measuresTaken,
      },
      ['discovered_at', 'data_categories', 'approx_subjects', 'approx_records'],
      TEXT,
    );
    if (Object.keys(changes).length > 0) {
      await privacyDb(tx)
        .updateTable(TABLE)
        .set({
          discovered_at: body.discoveredAt,
          description: body.description,
          data_categories: body.dataCategories,
          approx_subjects: body.approximateSubjects,
          approx_records: body.approximateRecords,
          consequences: body.likelyConsequences,
          measures: body.measuresTaken,
          updated_by: context.membership.id,
        })
        .where('id', '=', breachId)
        .execute();
      await context.audit.record({
        action: 'privacy.breach.updated',
        entityId: breachId,
        changes,
      });
    }
    return readBreach(tx, breachId);
  }

  async function assessBreach({
    tx,
    context,
    input,
  }: Args<BreachParams & { body: AssessmentInput }>): Promise<Assessment> {
    const { breachId } = input.params;
    const { riskLevel, notifyIco, notifySubjects, rationale } = input.body;
    await lockBreach(tx, breachId);
    const row = await privacyDb(tx)
      .insertInto('privacy.breach_assessment')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        breach_id: breachId,
        risk_level: riskLevel,
        notify_ico: notifyIco,
        notify_subjects: notifySubjects,
        rationale,
        assessed_by: context.membership.id,
      }))
      .returningAll()
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'privacy.breach.assessed',
      entityId: breachId,
      changes: {
        'privacy.breach_assessment.risk_level': { after: riskLevel },
        'privacy.breach_assessment.notify_ico': { after: notifyIco },
        'privacy.breach_assessment.notify_subjects': { after: notifySubjects },
        'privacy.breach_assessment.rationale': {},
      },
    });
    return toAssessment(row);
  }

  async function recordIcoNotification({
    tx,
    context,
    input,
  }: Args<BreachParams & { body: IcoNotificationInput }>): Promise<Breach> {
    const { breachId } = input.params;
    const { notifiedAt, reference, lateReason } = input.body;
    const found = await lockBreach(tx, breachId);
    if (found.ico_notified_at !== null) throw deps.refuse(409, refusals.alreadyNotified);
    const message = icoNotificationProblem(
      iso(found.became_aware_at),
      { notifiedAt, lateReason },
      iso(deps.now()),
    );
    if (message !== null) {
      const field =
        message === privacyMessages.timeInFuture || message === privacyMessages.notifiedBeforeAware
          ? 'notifiedAt'
          : 'lateReason';
      throw deps.refuse(400, message, [{ field: `body.${field}`, message }]);
    }

    await privacyDb(tx)
      .updateTable(TABLE)
      .set({
        ico_notified_at: notifiedAt,
        ico_reference: reference,
        ico_late_reason: lateReason,
        ico_recorded_by: context.membership.id,
        updated_by: context.membership.id,
      })
      .where('id', '=', breachId)
      .execute();
    await context.audit.record({
      action: 'privacy.breach.ico_notified',
      entityId: breachId,
      changes: {
        [`${TABLE}.ico_notified_at`]: { after: notifiedAt },
        [`${TABLE}.ico_late_reason`]: { after: lateReason },
        [`${TABLE}.ico_reference`]: {},
      },
    });
    return readBreach(tx, breachId);
  }

  async function recordSubjectNotification({
    tx,
    context,
    input,
  }: Args<BreachParams & { body: SubjectNotificationInput }>): Promise<Breach> {
    const { breachId } = input.params;
    const { notifiedAt, method } = input.body;
    const found = await lockBreach(tx, breachId);
    if (found.subjects_notified_at !== null) throw deps.refuse(409, refusals.alreadyNotified);
    refuseFuture({ notifiedAt });

    await privacyDb(tx)
      .updateTable(TABLE)
      .set({
        subjects_notified_at: notifiedAt,
        subjects_notice_method: method,
        subjects_recorded_by: context.membership.id,
        updated_by: context.membership.id,
      })
      .where('id', '=', breachId)
      .execute();
    await context.audit.record({
      action: 'privacy.breach.subjects_notified',
      entityId: breachId,
      changes: {
        [`${TABLE}.subjects_notified_at`]: { after: notifiedAt },
        [`${TABLE}.subjects_notice_method`]: { after: method },
      },
    });
    return readBreach(tx, breachId);
  }

  /** Answers a replayed notification with the breach as it reads now, without a view event. */
  const replayBreach = ({ tx, input }: ReplayArgs<BreachParams>) =>
    readBreach(tx, input.params.breachId);

  /** Answers a replayed create with the breach as it reads now. */
  const replayCreatedBreach = ({ tx, id }: ReplayArgs<unknown>) =>
    id === null ? Promise.reject(deps.notFound()) : readBreach(tx, id);

  /** Answers a replayed assessment with the assessment as it reads now. */
  const replayAssessment = async ({ tx, input, id }: ReplayArgs<BreachParams>) => {
    const row = (await readAssessments(tx, [input.params.breachId])).find(
      (assessment) => assessment.id === id,
    );
    if (row === undefined) throw deps.notFound();
    return toAssessment(row);
  };

  return {
    listBreaches,
    createBreach,
    getBreach,
    updateBreach,
    assessBreach,
    recordIcoNotification,
    recordSubjectNotification,
    replayBreach,
    replayCreatedBreach,
    replayAssessment,
  };
}
