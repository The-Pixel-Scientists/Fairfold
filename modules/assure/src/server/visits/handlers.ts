// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The monitoring visit routes' handlers. A visit belongs to an organisation of
// the tenant, and to one of its submitted applications or none. Attendees are
// people of the tenant and evidence is files linked through the file service
// (ADR 0030), which the database links and releases. Findings may name people,
// so reading a visit is a sensitive read, audited with the organisation as the
// subject; recording and changing one are audited by id and code, never
// findings. A replay of a recording answers as the first answer did.

import { idSchema } from '@pixel-scientists/domain';
import { organisationSummaries } from '@pixel-scientists/party/server';

import {
  visitInputSchema,
  visitQuerySchema,
  visitUpdateSchema,
  type VisitUpdate,
} from '../../contracts/index.ts';
import {
  assureDb,
  isMissingReference,
  isRefusedByRule,
  type Args,
  type AssureDb,
  type ChecklistDependencies,
  type Tx,
} from '../checklists/context.ts';
import { FILES_NOT_READY, filesReady } from '../checklists/files.ts';
import { lockVisit, readVisit, visitPage } from './store.ts';

const CHECK_VISIT = 'Check the visit and try again.';
const BAD_PAGE = 'That page link is not valid. Start again from the first page.';
const ERASED = "This organisation has been erased, so its visits can't be changed.";

const encodeCursor = (visitedOn: string, id: string): string =>
  Buffer.from(`${visitedOn}|${id}`).toString('base64url');

function decodeCursor(cursor: string): { visitedOn: string; id: string } | null {
  const [visitedOn, id, ...rest] = Buffer.from(cursor, 'base64url').toString().split('|');
  return rest.length === 0 &&
    visitedOn !== undefined &&
    /^\d{4}-\d{2}-\d{2}$/.test(visitedOn) &&
    idSchema.safeParse(id).success
    ? { visitedOn, id: id as string }
    : null;
}

export function visitHandlers(deps: ChecklistDependencies) {
  const idOrNotFound = (value: unknown): string => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw deps.notFound();
    return parsed.data;
  };

  const found = async (tx: Tx, visitId: string) => {
    const visit = await readVisit(tx, visitId);
    if (visit === null) throw deps.notFound();
    return visit;
  };

  /** Turns the failures a request can foresee but not rule out into plain refusals. */
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isMissingReference(error)) throw deps.refuse(400, CHECK_VISIT);
      if (isRefusedByRule(error)) throw deps.refuse(409, ERASED);
      throw error;
    }
  }

  /** Makes the attendees and evidence of a visit match `wanted`, keeping what is already there. */
  async function settle(
    db: AssureDb,
    visitId: string,
    wanted: Pick<VisitUpdate, 'attendeePersonIds' | 'evidence'>,
    actor: string,
  ): Promise<void> {
    const attendees = await db
      .selectFrom('assure.visit_attendee')
      .select(['id', 'person_id'])
      .where('visit_id', '=', visitId)
      .execute();
    const people = new Set(wanted.attendeePersonIds);
    const present = new Set(attendees.map(({ person_id: id }) => id));
    const gone = attendees.filter(({ person_id: id }) => !people.has(id));
    if (gone.length > 0) {
      await db
        .deleteFrom('assure.visit_attendee')
        .where(
          'id',
          'in',
          gone.map(({ id }) => id),
        )
        .execute();
    }
    const arriving = wanted.attendeePersonIds.filter((id) => !present.has(id));
    if (arriving.length > 0) {
      await db
        .insertInto('assure.visit_attendee')
        .values((eb) =>
          arriving.map((personId) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            visit_id: visitId,
            person_id: personId,
          })),
        )
        .execute();
    }

    const held = await db
      .selectFrom('assure.visit_evidence')
      .select(['id', 'file_id', 'caption'])
      .where('visit_id', '=', visitId)
      .execute();
    const captions = new Map(wanted.evidence.map(({ fileId, caption }) => [fileId, caption]));
    const have = new Map(held.map(({ file_id: fileId, caption }) => [fileId, caption]));
    const added = wanted.evidence.filter(({ fileId }) => !have.has(fileId));
    if (
      !(await filesReady(
        db,
        added.map(({ fileId }) => fileId),
      ))
    ) {
      throw deps.refuse(400, FILES_NOT_READY);
    }
    const removed = held.filter(({ file_id: fileId }) => !captions.has(fileId));
    if (removed.length > 0) {
      await db
        .deleteFrom('assure.visit_evidence')
        .where(
          'id',
          'in',
          removed.map(({ id }) => id),
        )
        .execute();
    }
    for (const { fileId, caption } of wanted.evidence) {
      if (have.has(fileId) && have.get(fileId) !== caption) {
        await db
          .updateTable('assure.visit_evidence')
          .set({ caption })
          .where('visit_id', '=', visitId)
          .where('file_id', '=', fileId)
          .execute();
      }
    }
    if (added.length > 0) {
      await db
        .insertInto('assure.visit_evidence')
        .values((eb) =>
          added.map(({ fileId, caption }) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            visit_id: visitId,
            file_id: fileId,
            caption,
            added_by: actor,
          })),
        )
        .execute();
    }
  }

  const shape = (body: VisitUpdate) => ({
    visited_on: body.visitedOn,
    visit_type: body.type,
    findings: body.findings,
    follow_ups: JSON.stringify(body.followUps),
  });

  /** Newest first, as summaries with no findings, so no sensitive read. */
  async function listVisits({ tx, input }: Args<{ query: unknown }>) {
    const query = visitQuerySchema.safeParse(input.query);
    if (!query.success) throw deps.refuse(400, 'Check the filters and try again.');
    const after = query.data.cursor === undefined ? null : decodeCursor(query.data.cursor);
    if (query.data.cursor !== undefined && after === null) throw deps.refuse(400, BAD_PAGE);
    const { visits, next } = await visitPage(tx, query.data, after);
    return {
      visits,
      nextCursor: next === null ? null : encodeCursor(next.visitedOn, next.id),
    };
  }

  async function createVisit({ tx, context, input }: Args<{ body: unknown }>) {
    const parsed = visitInputSchema.safeParse(input.body);
    if (!parsed.success) throw deps.refuse(400, CHECK_VISIT);
    const body = parsed.data;
    const [organisation] = await organisationSummaries(tx, [body.organisationId]);
    if (organisation === undefined) {
      throw deps.refuse(400, 'Choose an organisation from your records.');
    }
    if (body.applicationId !== null) {
      const applicant = await deps.readApplicant(tx, body.applicationId);
      if (applicant?.organisationId !== body.organisationId) {
        throw deps.refuse(400, "Choose an application from this organisation's submissions.");
      }
    }
    const db = assureDb(tx);
    const actor = context.membership.id;
    const id = await guarded(async () => {
      const { id: created } = await db
        .insertInto('assure.monitoring_visit')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          organisation_id: body.organisationId,
          application_id: body.applicationId,
          ...shape(body),
          recorded_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await settle(db, created, body, actor);
      return created;
    });
    await context.audit.record({
      action: 'assure.visit.recorded',
      entityId: id,
      subjectPartyId: body.organisationId,
      changes: { 'assure.monitoring_visit.visit_type': { after: body.type } },
    });
    return found(tx, id);
  }

  /** A replay of a recording: the visit as it reads now, to the member who recorded it. */
  const replayVisit = ({ tx, id }: { tx: Tx; id: string | null }) => found(tx, idOrNotFound(id));

  async function getVisit({ tx, context, input }: Args<{ params: { visitId: string } }>) {
    const visit = await found(tx, idOrNotFound(input.params.visitId));
    await context.audit.read({
      action: 'assure.visit.viewed',
      entityId: visit.id,
      subjectPartyId: visit.organisationId,
    });
    return visit;
  }

  async function updateVisit({
    tx,
    context,
    input,
  }: Args<{ params: { visitId: string }; body: unknown }>) {
    const visitId = idOrNotFound(input.params.visitId);
    const parsed = visitUpdateSchema.safeParse(input.body);
    if (!parsed.success) throw deps.refuse(400, CHECK_VISIT);
    const body = parsed.data;
    const organisationId = await lockVisit(tx, visitId);
    if (organisationId === null) throw deps.notFound();
    const db = assureDb(tx);
    const actor = context.membership.id;
    await guarded(async () => {
      await db
        .updateTable('assure.monitoring_visit')
        .set({ ...shape(body), updated_by: actor })
        .where('id', '=', visitId)
        .execute();
      await settle(db, visitId, body, actor);
    });
    await context.audit.record({
      action: 'assure.visit.updated',
      entityId: visitId,
      subjectPartyId: organisationId,
      changes: { 'assure.monitoring_visit.visit_type': { after: body.type } },
    });
    return found(tx, visitId);
  }

  return { listVisits, createVisit, replayVisit, getVisit, updateVisit };
}
