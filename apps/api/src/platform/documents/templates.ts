// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document template versions (ADR 0040, rule 10). A version is never updated
// or deleted: the database refuses both, and a change is a new version. The
// server, never a request, chooses the version a document uses: the tenant's
// latest of the kind, which a job request then pins. A tenant with none gets
// the built-in default as version 1, published by the member whose request
// needed it, in that request's transaction, with its configuration version
// and its audit event.

import { randomUUID } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import {
  documentKinds,
  templateVersionSchema,
  type DocumentKind,
  type TemplateVersion,
} from '@pixel-scientists/domain/documents';

import { recordAudit } from '../../audit/writer.ts';
import { insertConfigVersion } from '../config-versions.ts';
import type { TenantTransaction } from '../../database.ts';

type Tables = {
  'app.document_template_version': {
    tenant_id: string;
    id: { __select__: string; __insert__: string | undefined; __update__: string };
    template_id: string;
    version: number;
    kind: DocumentKind;
    audience: TemplateVersion['audience'];
    title: string;
    merge_fields: string[];
    body: { __select__: unknown; __insert__: string; __update__: string };
    created_by: string;
    created_at: { __select__: Date; __insert__: Date | undefined; __update__: Date };
  };
};

const columns = [
  'id',
  'template_id',
  'version',
  'kind',
  'audience',
  'title',
  'merge_fields',
  'body',
] as const;

const db = (tx: Transaction<unknown>) => tx.$extendTables<Tables>();

/** The board pack every tenant starts with: the staff view, with the fixed details of each application. */
export const DEFAULT_BOARD_PACK = {
  kind: 'board_pack',
  audience: 'staff',
  title: 'Board pack',
  mergeFields: [],
  body: [
    { type: 'heading', level: 1, text: 'Answers' },
    {
      type: 'paragraph',
      content: [{ text: 'No questions are chosen for this board pack.' }],
    },
  ],
} as const satisfies Omit<TemplateVersion, 'id' | 'templateId' | 'version'>;

function toVersion(row: {
  id: string;
  template_id: string;
  version: number;
  kind: DocumentKind;
  audience: TemplateVersion['audience'];
  title: string;
  merge_fields: string[];
  body: unknown;
}): TemplateVersion {
  const parsed = templateVersionSchema.safeParse({
    id: row.id,
    templateId: row.template_id,
    version: row.version,
    kind: row.kind,
    audience: row.audience,
    title: row.title,
    mergeFields: row.merge_fields,
    body: row.body,
  });
  // The error is not passed on: it could repeat the template's text.
  if (!parsed.success) throw new Error('A stored template version is not valid.');
  return parsed.data;
}

/** The tenant's latest published version of the kind, if it has one. */
export async function latestTemplateVersion(
  tx: Transaction<unknown>,
  kind: DocumentKind,
): Promise<TemplateVersion | undefined> {
  const row = await db(tx)
    .selectFrom('app.document_template_version')
    .select(columns)
    .where('kind', '=', kind)
    .orderBy('created_at', 'desc')
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? undefined : toVersion(row);
}

/** One version of the tenant, by id: what a job pinned. */
export async function templateVersionById(
  tx: Transaction<unknown>,
  id: string,
): Promise<TemplateVersion | undefined> {
  const row = await db(tx)
    .selectFrom('app.document_template_version')
    .select(columns)
    .where('id', '=', id)
    .executeTakeFirst();
  return row === undefined ? undefined : toVersion(row);
}

/**
 * The tenant's latest version of the kind, publishing the built-in default
 * as version 1 first if there is none. Concurrent requests wait their turn on
 * the tenant's lock, so one tenant never gets two first versions.
 */
export async function latestOrDefaultTemplateVersion(
  tx: TenantTransaction,
  author: { readonly membershipId: string; readonly requestId: string },
  kind: Extract<DocumentKind, 'board_pack'>,
): Promise<TemplateVersion> {
  if (!documentKinds.includes(kind)) throw new Error('Unknown document kind.');
  await tx
    .selectNoFrom((eb) =>
      eb
        .fn('pg_advisory_xact_lock', [
          eb.fn('hashtextextended', [
            eb.fn('concat', [
              eb.cast(eb.fn('app.current_tenant_id', []), 'text'),
              eb.cast(eb.val(`:template:${kind}`), 'text'),
            ]),
            eb.cast(eb.val(0), 'bigint'),
          ]),
        ])
        .as('locked'),
    )
    .execute();
  const found = await latestTemplateVersion(tx, kind);
  if (found !== undefined) return found;

  const templateId = randomUUID();
  const inserted = await db(tx)
    .insertInto('app.document_template_version')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      template_id: templateId,
      version: 1,
      kind,
      audience: DEFAULT_BOARD_PACK.audience,
      title: DEFAULT_BOARD_PACK.title,
      merge_fields: [...DEFAULT_BOARD_PACK.mergeFields],
      body: JSON.stringify(DEFAULT_BOARD_PACK.body),
      created_by: author.membershipId,
    }))
    .returning(columns)
    .executeTakeFirstOrThrow();
  const version = toVersion(inserted);
  await insertConfigVersion(tx, author.membershipId, 'platform.document_template', templateId, [
    { field: 'version', from: null, to: 1 },
    { field: 'kind', from: null, to: kind },
    { field: 'audience', from: null, to: version.audience },
    { field: 'mergeFields', added: version.mergeFields, removed: [] },
  ]);
  await recordAudit(
    tx,
    { kind: 'user', ...author },
    {
      action: 'platform.document_template.published',
      entityId: version.id,
      changes: {
        'app.document_template_version.template_id': { after: templateId },
        'app.document_template_version.version': { after: 1 },
        'app.document_template_version.kind': { after: kind },
      },
    },
  );
  return version;
}
