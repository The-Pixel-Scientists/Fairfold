// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application's answers to a due diligence checklist (rule 7). Answers are
// keyed by the item ids of the version they are pinned to: the first save
// pins the newest version and a later save must name the same one. Yes or
// no, date and short text answers are stored with the response; a file
// answer holds the ids of files linked through the file service (ADR 0030),
// which the database links and releases. Reading answers is a sensitive read
// and saving them a state change, each audited with the applicant as the
// subject and never an answer. The application must be one grants says the
// funder may see.

import { idSchema } from '@pixel-scientists/domain';

import { checklistResponseInputSchema, type ChecklistResponse } from '../../contracts/index.ts';
import {
  assureDb,
  isRefusedByRule,
  isTaken,
  iso,
  type Args,
  type AssureDb,
  type ChecklistDependencies,
} from './context.ts';
import { FILES_NOT_READY, filesReady } from './files.ts';
import { isComplete } from './items.ts';
import { currentVersions, toVersion, versionColumns } from './templates.ts';

const CHECK_ANSWERS = 'Check the answers and try again.';
const OTHER_VERSION =
  'These answers belong to a different version of the checklist. Reload it and try again.';
const SAVED_ELSEWHERE = 'Someone else has saved these answers. Reload them and try again.';
const CHANGE_REFUSED = "These answers can't be changed any more.";

type Current = Awaited<ReturnType<ReturnType<typeof currentVersions>['execute']>>[number];
type Answers = ChecklistResponse['answers'];

export function responseHandlers(deps: ChecklistDependencies) {
  const idOrNotFound = (value: unknown): string => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw deps.notFound();
    return parsed.data;
  };

  async function applicantOf(tx: Args<unknown>['tx'], applicationId: string) {
    const applicant = await deps.readApplicant(tx, applicationId);
    if (applicant === null) throw deps.notFound();
    return applicant;
  }

  async function currentOf(db: AssureDb, checklistId: string): Promise<Current> {
    const current = await currentVersions(db).where('c.id', '=', checklistId).executeTakeFirst();
    if (current === undefined) throw deps.notFound();
    return current;
  }

  /** The answers as saved, or the newest version with none before the first save. */
  async function readResponse(
    db: AssureDb,
    applicationId: string,
    current: Current,
  ): Promise<{ responseId: string | null; response: ChecklistResponse }> {
    const stored = await db
      .selectFrom('assure.checklist_response as r')
      .innerJoin('assure.checklist_version as v', 'v.id', 'r.checklist_version_id')
      .select(['r.id as response_id', 'r.answers', 'r.updated_at', ...versionColumns])
      .where('r.application_id', '=', applicationId)
      .where('r.checklist_id', '=', current.checklist_id)
      .executeTakeFirst();
    const answers: Answers = { ...(stored?.answers as Answers | undefined) };
    if (stored !== undefined) {
      const files = await db
        .selectFrom('assure.checklist_response_file')
        .select(['item_id', 'file_id'])
        .where('response_id', '=', stored.response_id)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      for (const { item_id: itemId, file_id: fileId } of files) {
        const held = answers[itemId];
        answers[itemId] = {
          kind: 'file',
          fileIds: [...(held?.kind === 'file' ? held.fileIds : []), fileId],
        };
      }
    }
    const version = toVersion(stored ?? current);
    return {
      responseId: stored?.response_id ?? null,
      response: {
        checklistId: current.checklist_id,
        applicationId,
        version,
        answers,
        complete: isComplete(version.items, new Set(Object.keys(answers))),
        savedAt: stored === undefined ? null : iso(stored.updated_at),
      },
    };
  }

  /** Every checklist still in use, with how far this application's answers have got. */
  async function listApplicationChecklists({
    tx,
    input,
  }: Args<{ params: { applicationId: string } }>) {
    const applicationId = idOrNotFound(input.params.applicationId);
    await applicantOf(tx, applicationId);
    const db = assureDb(tx);
    const checklists = await currentVersions(db)
      .where('c.archived_at', 'is', null)
      .orderBy('v.name')
      .orderBy('c.id')
      .execute();
    return {
      checklists: await Promise.all(
        checklists.map(async (current) => {
          const { response } = await readResponse(db, applicationId, current);
          return {
            checklistId: current.checklist_id,
            name: current.name,
            versionId: response.version.id,
            complete: response.complete,
            savedAt: response.savedAt,
          };
        }),
      ),
    };
  }

  /** The answers with the version they answer: a sensitive read once there are answers to read. */
  async function getChecklistResponse({
    tx,
    context,
    input,
  }: Args<{ params: { applicationId: string; checklistId: string } }>) {
    const applicationId = idOrNotFound(input.params.applicationId);
    const checklistId = idOrNotFound(input.params.checklistId);
    const applicant = await applicantOf(tx, applicationId);
    const db = assureDb(tx);
    const { responseId, response } = await readResponse(
      db,
      applicationId,
      await currentOf(db, checklistId),
    );
    if (responseId !== null) {
      await context.audit.read({
        action: 'assure.checklist_response.viewed',
        entityId: responseId,
        subjectPartyId: applicant.applicantPersonId,
      });
    }
    return response;
  }

  async function saveChecklistResponse({
    tx,
    context,
    input,
  }: Args<{ params: { applicationId: string; checklistId: string }; body: unknown }>) {
    const applicationId = idOrNotFound(input.params.applicationId);
    const checklistId = idOrNotFound(input.params.checklistId);
    const body = checklistResponseInputSchema.safeParse(input.body);
    if (!body.success) throw deps.refuse(400, CHECK_ANSWERS);
    const applicant = await applicantOf(tx, applicationId);
    const db = assureDb(tx);
    const actor = context.membership.id;
    const current = await currentOf(db, checklistId);
    if (current.archived_at !== null) {
      throw deps.refuse(409, 'This checklist is archived, so it takes no new answers.');
    }

    const existing = await db
      .selectFrom('assure.checklist_response')
      .select(['id', 'checklist_version_id'])
      .where('application_id', '=', applicationId)
      .where('checklist_id', '=', checklistId)
      .forUpdate()
      .executeTakeFirst();
    const pinned = existing?.checklist_version_id ?? current.id;
    if (body.data.versionId !== pinned) throw deps.refuse(409, OTHER_VERSION);
    const version = await db
      .selectFrom('assure.checklist_version as v')
      .select(versionColumns)
      .where('v.id', '=', pinned)
      .executeTakeFirstOrThrow();

    const kinds = new Map(toVersion(version).items.map(({ id, kind }) => [id, kind]));
    const given = Object.entries(body.data.answers);
    const files = given.flatMap(([itemId, answer]) =>
      answer.kind === 'file' ? answer.fileIds.map((fileId) => ({ itemId, fileId })) : [],
    );
    if (
      given.some(([itemId, { kind }]) => kinds.get(itemId) !== kind) ||
      new Set(files.map(({ fileId }) => fileId)).size !== files.length
    ) {
      throw deps.refuse(400, CHECK_ANSWERS);
    }
    const answers = JSON.stringify(
      Object.fromEntries(given.filter(([, answer]) => answer.kind !== 'file')),
    );

    try {
      let responseId: string;
      if (existing === undefined) {
        ({ id: responseId } = await db
          .insertInto('assure.checklist_response')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            application_id: applicationId,
            checklist_id: checklistId,
            checklist_version_id: pinned,
            answers,
            saved_by: actor,
          }))
          .returning('id')
          .executeTakeFirstOrThrow());
      } else {
        responseId = existing.id;
        await db
          .updateTable('assure.checklist_response')
          .set({ answers, saved_by: actor })
          .where('id', '=', responseId)
          .execute();
      }

      const held = await db
        .selectFrom('assure.checklist_response_file')
        .select(['id', 'item_id', 'file_id'])
        .where('response_id', '=', responseId)
        .execute();
      const keyOf = (itemId: string, fileId: string) => `${itemId}:${fileId}`;
      const wanted = new Set(files.map(({ itemId, fileId }) => keyOf(itemId, fileId)));
      const kept = new Set(held.map(({ item_id: i, file_id: f }) => keyOf(i, f)));
      const removed = held.filter(({ item_id: i, file_id: f }) => !wanted.has(keyOf(i, f)));
      const added = files.filter(({ itemId, fileId }) => !kept.has(keyOf(itemId, fileId)));
      if (
        !(await filesReady(
          db,
          added.map(({ fileId }) => fileId),
        ))
      ) {
        throw deps.refuse(400, FILES_NOT_READY);
      }
      if (removed.length > 0) {
        await db
          .deleteFrom('assure.checklist_response_file')
          .where(
            'id',
            'in',
            removed.map(({ id }) => id),
          )
          .execute();
      }
      if (added.length > 0) {
        await db
          .insertInto('assure.checklist_response_file')
          .values((eb) =>
            added.map(({ itemId, fileId }) => ({
              tenant_id: eb.fn<string>('app.current_tenant_id', []),
              response_id: responseId,
              item_id: itemId,
              file_id: fileId,
              created_by: actor,
            })),
          )
          .execute();
      }

      await context.audit.record({
        action: 'assure.checklist_response.saved',
        entityId: responseId,
        subjectPartyId: applicant.applicantPersonId,
        changes: { 'assure.checklist_response.checklist_version_id': { after: pinned } },
      });
    } catch (error) {
      if (isTaken(error)) throw deps.refuse(409, SAVED_ELSEWHERE);
      if (isRefusedByRule(error)) throw deps.refuse(409, CHANGE_REFUSED);
      throw error;
    }
    return (await readResponse(db, applicationId, current)).response;
  }

  return { listApplicationChecklists, getChecklistResponse, saveChecklistResponse };
}
