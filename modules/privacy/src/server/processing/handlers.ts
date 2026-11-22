// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The records of processing: the generated record, and the processing
// activities and processors a tenant records beside it. The contracts have
// checked the codes against their lists, and the database checks them again.
// An audit event names the ids and the codes that changed, and the text
// columns by name alone: a name, a purpose or a recipient never appears as a
// value. Actors come from the session and times from the database.

import type { AuditChanges, FieldChange } from '@pixel-scientists/db';

import type {
  ProcessingActivity,
  ProcessingActivityInput,
  ProcessingRecord,
  Processor,
  ProcessorInput,
} from '../../contracts/index.ts';
import {
  isMissingReference,
  iso,
  privacyDb,
  type Args,
  type PrivacyDb,
  type PrivacyDependencies,
  type ReplayArgs,
  type Tx,
} from '../context.ts';
import { decodeCursor, PAGE_SIZE, toPage } from '../page.ts';
import { processingRecordEntries } from './records.ts';

export interface ActivityParams {
  readonly params: { readonly activityId: string };
}

export interface ProcessorParams {
  readonly params: { readonly processorId: string };
}

const ACTIVITY = 'privacy.processing_activity';
const PROCESSOR = 'privacy.processor';
const LINK = 'privacy.processing_activity_processor';

const refusals = {
  page: 'This page of results is no longer available. Start again from the first page.',
  processors: 'Choose processors from your records.',
  activityName: 'You already have a processing activity with this name. Choose another name.',
} as const;

const UNIQUE_VIOLATION = '23505';

/** An audit event's changes: the codes that differ with both values, and the text columns that differ by name only. */
function diff(
  table: string,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  codes: readonly string[],
  text: readonly string[],
): AuditChanges {
  const differs = (column: string) =>
    JSON.stringify(before[column]) !== JSON.stringify(after[column]);
  return Object.fromEntries([
    ...codes
      .filter(differs)
      .map((column) => [`${table}.${column}`, { before: before[column], after: after[column] }]),
    ...text.filter(differs).map((column) => [`${table}.${column}`, {}]),
  ]) as AuditChanges;
}

const activityCodes = [
  'legal_basis',
  'special_category_condition',
  'data_categories',
  'subject_categories',
];
const activityText = [
  'name',
  'purpose',
  'recipients',
  'transfers_abroad',
  'retention',
  'security_measures',
];
const processorCodes = ['country_code', 'contract_signed_on', 'transfer_safeguard'];
const processorText = ['name', 'service'];

const selectActivities = (db: PrivacyDb) =>
  db
    .selectFrom('privacy.processing_activity as a')
    .select([
      'a.id',
      'a.name',
      'a.purpose',
      'a.legal_basis',
      'a.special_category_condition',
      'a.data_categories',
      'a.subject_categories',
      'a.recipients',
      'a.transfers_abroad',
      'a.retention',
      'a.security_measures',
      'a.updated_at',
    ])
    .where('a.archived_at', 'is', null);

type ActivityRow = Awaited<
  ReturnType<ReturnType<typeof selectActivities>['executeTakeFirstOrThrow']>
>;

const selectProcessors = (db: PrivacyDb) =>
  db
    .selectFrom('privacy.processor as p')
    .select((eb) => [
      'p.id',
      'p.name',
      'p.service',
      'p.country_code',
      eb.cast<string | null>('p.contract_signed_on', 'text').as('contract_signed_on'),
      'p.transfer_safeguard',
      'p.updated_at',
    ])
    .where('p.archived_at', 'is', null);

type ProcessorRow = Awaited<
  ReturnType<ReturnType<typeof selectProcessors>['executeTakeFirstOrThrow']>
>;

const toProcessor = (row: ProcessorRow): Processor => ({
  id: row.id,
  name: row.name,
  service: row.service,
  countryCode: row.country_code,
  contractSignedOn: row.contract_signed_on,
  transferSafeguard: row.transfer_safeguard as Processor['transferSafeguard'],
  updatedAt: iso(row.updated_at),
});

export function processingHandlers(deps: PrivacyDependencies) {
  const linkedProcessors = async (tx: Tx, activityIds: readonly string[]) =>
    activityIds.length === 0
      ? []
      : privacyDb(tx)
          .selectFrom(LINK)
          .select(['processing_activity_id', 'processor_id'])
          .where('processing_activity_id', 'in', activityIds)
          .orderBy('created_at')
          .orderBy('id')
          .execute();

  const toActivities = async (
    tx: Tx,
    rows: readonly ActivityRow[],
  ): Promise<ProcessingActivity[]> => {
    const links = await linkedProcessors(
      tx,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      legalBasis: row.legal_basis as ProcessingActivity['legalBasis'],
      specialCategoryCondition:
        row.special_category_condition as ProcessingActivity['specialCategoryCondition'],
      dataCategories: row.data_categories as ProcessingActivity['dataCategories'],
      subjectCategories: row.subject_categories as ProcessingActivity['subjectCategories'],
      recipients: row.recipients,
      processorIds: links
        .filter((link) => link.processing_activity_id === row.id)
        .map((link) => link.processor_id),
      transfersAbroad: row.transfers_abroad,
      retention: row.retention,
      securityMeasures: row.security_measures,
      updatedAt: iso(row.updated_at),
    }));
  };

  async function readActivity(tx: Tx, activityId: string, lock = false): Promise<ActivityRow> {
    const query = selectActivities(privacyDb(tx)).where('a.id', '=', activityId);
    const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return row;
  }

  async function readProcessor(tx: Tx, processorId: string, lock = false): Promise<ProcessorRow> {
    const query = selectProcessors(privacyDb(tx)).where('p.id', '=', processorId);
    const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return row;
  }

  /** Runs a write, answering a processor that is not this tenant's, or a name already used, as the member's to fix. */
  async function writing<T>(work: () => Promise<T>, field?: string): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isMissingReference(error)) {
        const message = refusals.processors;
        throw deps.refuse(400, message, [{ field: 'body.processorIds', message }]);
      }
      if ((error as { code?: unknown }).code === UNIQUE_VIOLATION && field !== undefined) {
        const message = refusals.activityName;
        throw deps.refuse(409, message, [{ field, message }]);
      }
      throw error;
    }
  }

  /** Links and unlinks to match `wanted`. */
  async function setProcessors(
    tx: Tx,
    actor: string,
    activityId: string,
    wanted: readonly string[],
  ) {
    const db = privacyDb(tx);
    const current = (await linkedProcessors(tx, [activityId])).map((link) => link.processor_id);
    const added = wanted.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !wanted.includes(id));
    if (added.length > 0) {
      await db
        .insertInto(LINK)
        .values((eb) =>
          added.map((processorId) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            processing_activity_id: activityId,
            processor_id: processorId,
            created_by: actor,
          })),
        )
        .execute();
    }
    if (removed.length > 0) {
      await db
        .deleteFrom(LINK)
        .where('processing_activity_id', '=', activityId)
        .where('processor_id', 'in', removed)
        .execute();
    }
    return added.length + removed.length > 0;
  }

  const stored = (input: ProcessingActivityInput) => ({
    name: input.name,
    purpose: input.purpose,
    legal_basis: input.legalBasis,
    special_category_condition: input.specialCategoryCondition,
    data_categories: input.dataCategories,
    subject_categories: input.subjectCategories,
    recipients: input.recipients,
    transfers_abroad: input.transfersAbroad,
    retention: input.retention,
    security_measures: input.securityMeasures,
  });

  const getProcessingRecord = (): Promise<ProcessingRecord> =>
    Promise.resolve({ generatedAt: iso(deps.now()), tables: processingRecordEntries() });

  async function listProcessingActivities({ tx, input }: Args<{ query: { cursor?: string } }>) {
    const offset = decodeCursor(input.query.cursor);
    if (offset === null) throw deps.refuse(400, refusals.page);
    const rows = await selectActivities(privacyDb(tx))
      .orderBy('a.name')
      .orderBy('a.id')
      .limit(PAGE_SIZE + 1)
      .offset(offset)
      .execute();
    const { items, nextCursor } = toPage(rows, offset);
    return { activities: await toActivities(tx, items), nextCursor };
  }

  async function readOne(tx: Tx, activityId: string): Promise<ProcessingActivity> {
    const [activity] = await toActivities(tx, [await readActivity(tx, activityId)]);
    return activity as ProcessingActivity;
  }

  async function createProcessingActivity({
    tx,
    context,
    input,
  }: Args<{ body: ProcessingActivityInput }>): Promise<ProcessingActivity> {
    const actor = context.membership.id;
    const id = await writing(async () => {
      const { id: created } = await privacyDb(tx)
        .insertInto(ACTIVITY)
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          ...stored(input.body),
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await setProcessors(tx, actor, created, input.body.processorIds);
      return created;
    }, 'body.name');
    await context.audit.record({
      action: 'privacy.processing_activity.changed',
      entityId: id,
      changes: {
        [`${ACTIVITY}.legal_basis`]: { after: input.body.legalBasis },
        [`${ACTIVITY}.special_category_condition`]: { after: input.body.specialCategoryCondition },
        [`${ACTIVITY}.data_categories`]: { after: input.body.dataCategories },
        [`${ACTIVITY}.subject_categories`]: { after: input.body.subjectCategories },
        [`${LINK}.processor_id`]: { after: input.body.processorIds },
      },
    });
    return readOne(tx, id);
  }

  async function getProcessingActivity({ tx, input }: Args<ActivityParams>) {
    return readOne(tx, input.params.activityId);
  }

  async function updateProcessingActivity({
    tx,
    context,
    input,
  }: Args<ActivityParams & { body: ProcessingActivityInput }>): Promise<ProcessingActivity> {
    const { activityId } = input.params;
    const found = await readActivity(tx, activityId, true);
    const [before] = await toActivities(tx, [found]);
    const actor = context.membership.id;
    const after = stored(input.body);
    const changes: Record<string, FieldChange> = {
      ...diff(ACTIVITY, found, after, activityCodes, activityText),
    };
    await writing(async () => {
      await privacyDb(tx)
        .updateTable(ACTIVITY)
        .set({ ...after, updated_by: actor })
        .where('id', '=', activityId)
        .execute();
      if (await setProcessors(tx, actor, activityId, input.body.processorIds)) {
        changes[`${LINK}.processor_id`] = {
          before: before?.processorIds,
          after: input.body.processorIds,
        };
      }
    }, 'body.name');
    if (Object.keys(changes).length > 0) {
      await context.audit.record({
        action: 'privacy.processing_activity.changed',
        entityId: activityId,
        changes,
      });
    }
    return readOne(tx, activityId);
  }

  async function listProcessors({ tx, input }: Args<{ query: { cursor?: string } }>) {
    const offset = decodeCursor(input.query.cursor);
    if (offset === null) throw deps.refuse(400, refusals.page);
    const rows = await selectProcessors(privacyDb(tx))
      .orderBy('p.name')
      .orderBy('p.id')
      .limit(PAGE_SIZE + 1)
      .offset(offset)
      .execute();
    const { items, nextCursor } = toPage(rows, offset);
    return { processors: items.map(toProcessor), nextCursor };
  }

  const storedProcessor = (input: ProcessorInput) => ({
    name: input.name,
    service: input.service,
    country_code: input.countryCode,
    contract_signed_on: input.contractSignedOn,
    transfer_safeguard: input.transferSafeguard,
  });

  async function createProcessor({
    tx,
    context,
    input,
  }: Args<{ body: ProcessorInput }>): Promise<Processor> {
    const actor = context.membership.id;
    const { id } = await privacyDb(tx)
      .insertInto(PROCESSOR)
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        ...storedProcessor(input.body),
        created_by: actor,
        updated_by: actor,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'privacy.processor.changed',
      entityId: id,
      changes: {
        [`${PROCESSOR}.country_code`]: { after: input.body.countryCode },
        [`${PROCESSOR}.contract_signed_on`]: { after: input.body.contractSignedOn },
        [`${PROCESSOR}.transfer_safeguard`]: { after: input.body.transferSafeguard },
      },
    });
    return toProcessor(await readProcessor(tx, id));
  }

  async function updateProcessor({
    tx,
    context,
    input,
  }: Args<ProcessorParams & { body: ProcessorInput }>): Promise<Processor> {
    const { processorId } = input.params;
    const found = await readProcessor(tx, processorId, true);
    const after = storedProcessor(input.body);
    const changes = diff(PROCESSOR, found, after, processorCodes, processorText);
    if (Object.keys(changes).length > 0) {
      await privacyDb(tx)
        .updateTable(PROCESSOR)
        .set({ ...after, updated_by: context.membership.id })
        .where('id', '=', processorId)
        .execute();
      await context.audit.record({
        action: 'privacy.processor.changed',
        entityId: processorId,
        changes,
      });
    }
    return toProcessor(await readProcessor(tx, processorId));
  }

  /** Answers a replayed create with the record as it reads now. */
  const replayActivity = ({ tx, id }: ReplayArgs<unknown>) =>
    id === null ? Promise.reject(deps.notFound()) : readOne(tx, id);

  const replayProcessor = async ({ tx, id }: ReplayArgs<unknown>) =>
    id === null ? Promise.reject(deps.notFound()) : toProcessor(await readProcessor(tx, id));

  return {
    getProcessingRecord,
    listProcessingActivities,
    createProcessingActivity,
    getProcessingActivity,
    updateProcessingActivity,
    listProcessors,
    createProcessor,
    updateProcessor,
    replayActivity,
    replayProcessor,
  };
}
