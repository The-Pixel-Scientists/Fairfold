// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's 360Giving publisher details (D15): read, and saved once per
// tenant. Every save that changes something writes its configuration version
// (rule 10) and its audit event in the request's transaction; one that
// changes nothing writes neither.

import {
  configDiff,
  configDiffSchema,
  publisherSettingConfigEntityType,
  type ConfigDiff,
  type PublisherAnswer,
  type PublisherSetting,
  type PublisherSettingInput,
} from '../../contracts/index.ts';
import type { Args, GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';
import { exportDb } from './tables.ts';

export interface ExportDependencies extends Pick<
  GrantsDependencies,
  'notFound' | 'refuse' | 'tenantTimeZone'
> {
  /** Writes the publisher details' next configuration version in the request's transaction. */
  readonly recordConfig: (
    tx: Tx,
    authorId: string,
    entityType: typeof publisherSettingConfigEntityType,
    entityId: string,
    diff: ConfigDiff,
  ) => Promise<void>;
}

/** The column each of the details' diff paths is stored in. */
const columns = {
  funderIdentifier: 'funder_identifier',
  funderName: 'funder_name',
  identifierPrefix: 'identifier_prefix',
} as const;

const conflict = 'Someone else saved these details at the same moment. Reload and try again.';

export const readPublisher = async (tx: Tx): Promise<PublisherSetting | null> => {
  const row = await exportDb(tx)
    .selectFrom('grants.publisher_setting')
    .select(['funder_identifier', 'funder_name', 'identifier_prefix', 'updated_at'])
    .executeTakeFirst();
  return row === undefined
    ? null
    : {
        funderIdentifier: row.funder_identifier,
        funderName: row.funder_name,
        identifierPrefix: row.identifier_prefix,
        updatedAt: row.updated_at.toISOString(),
      };
};

export function publisherHandlers(deps: ExportDependencies) {
  async function getPublisherSetting({ tx }: Args<unknown>): Promise<PublisherAnswer> {
    return { publisher: await readPublisher(tx) };
  }

  async function savePublisherSetting({
    tx,
    context,
    input,
  }: Args<{ body: PublisherSettingInput }>): Promise<PublisherSetting> {
    const db = exportDb(tx);
    const actor = context.membership.id;
    const values = input.body;
    const found = await db
      .selectFrom('grants.publisher_setting')
      .select(['id', 'funder_identifier', 'funder_name', 'identifier_prefix'])
      .forUpdate()
      .executeTakeFirst();

    let id: string;
    let diff: ConfigDiff;
    if (found === undefined) {
      const inserted = await db
        .insertInto('grants.publisher_setting')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          funder_identifier: values.funderIdentifier,
          funder_name: values.funderName,
          identifier_prefix: values.identifierPrefix,
          created_by: actor,
          updated_by: actor,
        }))
        .onConflict((conflicting) => conflicting.column('tenant_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted === undefined) throw deps.refuse(409, conflict);
      id = inserted.id;
      diff = configDiff(null, values);
    } else {
      id = found.id;
      diff = configDiff(
        {
          funderIdentifier: found.funder_identifier,
          funderName: found.funder_name,
          identifierPrefix: found.identifier_prefix,
        },
        values,
      );
      if (diff.length > 0) {
        await db
          .updateTable('grants.publisher_setting')
          .set({
            funder_identifier: values.funderIdentifier,
            funder_name: values.funderName,
            identifier_prefix: values.identifierPrefix,
            updated_by: actor,
          })
          .where('id', '=', id)
          .execute();
      }
    }

    if (diff.length > 0) {
      await deps.recordConfig(
        tx,
        actor,
        publisherSettingConfigEntityType,
        id,
        configDiffSchema.parse(diff),
      );
      await context.audit.record({
        action: 'grants.publisher_setting.changed',
        entityId: id,
        changes: Object.fromEntries(
          diff.flatMap(({ path, from, to }) =>
            path in columns
              ? [
                  [
                    `grants.publisher_setting.${columns[path as keyof typeof columns]}`,
                    { before: from, after: to },
                  ],
                ]
              : [],
          ),
        ),
      });
    }
    const saved = await readPublisher(tx);
    return saved ?? Promise.reject(deps.notFound());
  }

  return { getPublisherSetting, savePublisherSetting };
}
