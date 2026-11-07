// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { notesMessages } from '@pixel-scientists/domain/notes';
import { describe, expect, it } from 'vitest';

import { programmeMessages } from '../programme/messages.ts';
import { triageMessages } from './messages.ts';
import * as triage from './routes.ts';
import {
  bulkLabelChangeInputSchema,
  bulkOwnerInputSchema,
  labelChangeInputSchema,
  labelDiff,
  labelInputSchema,
  MAX_LABEL_CHANGES,
  MAX_TRIAGE_SUBMISSIONS,
  ownerInputSchema,
} from './schemas.ts';

const routes = Object.values(triage.triageRoutes);
const ids = (count: number) =>
  Array.from({ length: count }, (_, i) => `5c1d2e3f-4a5b-4c6d-8e7f-${String(i).padStart(12, '0')}`);
const [A = '', B = ''] = ids(2);
const firstMessage = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('triage routes', () => {
  it('keep every route rule and are all listed in triageRoutes', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
    const exported = Object.values(triage).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('triage owners and labels, manage the label set, and let readers list it', () => {
    expect(routes.map((route) => `${route.permission} ${route.method} ${route.path}`)).toEqual([
      'grants.applications.triage PUT /console/submissions/:submissionId/owner',
      'grants.applications.triage POST /console/submission-owners',
      'grants.applications.triage PATCH /console/submissions/:submissionId/labels',
      'grants.applications.triage POST /console/submission-labels',
      'grants.applications.read GET /console/labels',
      'grants.programmes.manage POST /console/labels',
      'grants.programmes.manage PUT /console/labels/:labelId',
      'grants.programmes.manage POST /console/labels/:labelId/archive',
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        scope: 'tenant',
      });
    }
    expect(triage.createLabel.idempotent).toBe(true);
  });
});

describe('owner inputs', () => {
  it('take a membership id or null, never a tenant, actor or address', () => {
    expect(ownerInputSchema.parse({ ownerId: A })).toEqual({ ownerId: A });
    expect(ownerInputSchema.parse({ ownerId: null })).toEqual({ ownerId: null });
    for (const extra of ['tenantId', 'actorId', 'email', 'ownerEmail']) {
      expect(ownerInputSchema.safeParse({ ownerId: A, [extra]: B }).success, extra).toBe(false);
    }
    expect(ownerInputSchema.safeParse({ ownerId: 'sam@example.org' }).success).toBe(false);
  });

  it('take a capped list of submissions, each once', () => {
    const owner = { ownerId: A };
    expect(bulkOwnerInputSchema.safeParse({ ...owner, submissionIds: [A, B] }).success).toBe(true);
    expect(bulkOwnerInputSchema.safeParse({ ...owner, submissionIds: [] }).success).toBe(false);
    expect(firstMessage(bulkOwnerInputSchema.safeParse({ ...owner, submissionIds: [A, A] }))).toBe(
      programmeMessages.listedOnce,
    );
    const most = ids(MAX_TRIAGE_SUBMISSIONS);
    expect(bulkOwnerInputSchema.safeParse({ ...owner, submissionIds: most }).success).toBe(true);
    expect(
      bulkOwnerInputSchema.safeParse({ ...owner, submissionIds: ids(MAX_TRIAGE_SUBMISSIONS + 1) })
        .success,
    ).toBe(false);
  });
});

describe('label changes', () => {
  it('add and remove label sets, defaulting each to none', () => {
    expect(labelChangeInputSchema.parse({ add: [A] })).toEqual({ add: [A], remove: [] });
    expect(labelChangeInputSchema.parse({ remove: [B] })).toEqual({ add: [], remove: [B] });
  });

  it('refuse no label, a label in both lists, a repeat or too many', () => {
    expect(firstMessage(labelChangeInputSchema.safeParse({}))).toBe(triageMessages.chooseLabel);
    expect(firstMessage(labelChangeInputSchema.safeParse({ add: [A], remove: [A] }))).toBe(
      triageMessages.addOrRemove,
    );
    expect(firstMessage(labelChangeInputSchema.safeParse({ add: [A, A] }))).toBe(
      programmeMessages.listedOnce,
    );
    expect(labelChangeInputSchema.safeParse({ add: ids(MAX_LABEL_CHANGES + 1) }).success).toBe(
      false,
    );
    expect(labelChangeInputSchema.safeParse({ add: [A], names: ['Urgent'] }).success).toBe(false);
  });

  it('apply in bulk to a capped list of submissions', () => {
    expect(bulkLabelChangeInputSchema.parse({ submissionIds: [A], add: [B] })).toEqual({
      submissionIds: [A],
      add: [B],
      remove: [],
    });
    expect(bulkLabelChangeInputSchema.safeParse({ add: [B] }).success).toBe(false);
  });
});

describe('the label set', () => {
  it('takes a trimmed name and a colour from the theme tones', () => {
    expect(labelInputSchema.parse({ name: ' Needs budget check ' })).toEqual({
      name: 'Needs budget check',
      colour: null,
    });
    expect(labelInputSchema.parse({ name: 'Urgent', colour: 'danger' }).colour).toBe('danger');
    expect(labelInputSchema.safeParse({ name: 'Urgent', colour: '#ff0000' }).success).toBe(false);
    expect(firstMessage(labelInputSchema.safeParse({ name: ' ' }))).toBe(notesMessages.enterLabel);
    expect(labelInputSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(labelInputSchema.safeParse({ name: 'Urgent', archived: true }).success).toBe(false);
  });

  it('records each change by field path', () => {
    const urgent = { name: 'Urgent', colour: null, archived: false };
    expect(labelDiff(null, urgent)).toEqual([
      { path: 'name', from: null, to: 'Urgent' },
      { path: 'archived', from: null, to: false },
    ]);
    expect(labelDiff(urgent, { ...urgent, archived: true })).toEqual([
      { path: 'archived', from: false, to: true },
    ]);
  });
});
