// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { notesMessages } from '@pixel-scientists/domain/notes';
import { describe, expect, it } from 'vitest';

import * as notes from './routes.ts';

const routes = Object.values(notes.noteRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('note routes', () => {
  it('keep every route rule and are all listed in noteRoutes', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
    const exported = Object.values(notes).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('are console routes for staff who read applications, in the whole tenant', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/submissions/:submissionId/notes',
      'POST /console/submissions/:submissionId/notes',
      'GET /console/submissions/:submissionId/mentionable-members',
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.applications.read',
        scope: 'tenant',
      });
    }
  });

  it('add a note idempotently, and never edit or delete one', () => {
    expect(notes.addNote.idempotent).toBe(true);
    expect(routes.map((route) => route.method).sort()).toEqual(['GET', 'GET', 'POST']);
  });

  it('take a body and mention ids, never an author, tenant or application', () => {
    const { addNoteInputSchema } = notes;
    expect(addNoteInputSchema.parse({ body: ' Spoke to the applicant. ' })).toEqual({
      body: 'Spoke to the applicant.',
      mentions: [],
    });
    expect(addNoteInputSchema.parse({ body: 'See budget.', mentions: [ID] }).mentions).toEqual([
      ID,
    ]);
    for (const extra of ['authorId', 'tenantId', 'applicationId', 'side', 'createdAt']) {
      expect(addNoteInputSchema.safeParse({ body: 'Note', [extra]: ID }).success, extra).toBe(
        false,
      );
    }
    expect(addNoteInputSchema.safeParse({ body: ' ' }).error?.issues[0]?.message).toBe(
      notesMessages.enterNote,
    );
    expect(addNoteInputSchema.safeParse({ body: 'Note', mentions: ['@Sam'] }).success).toBe(false);
  });
});
