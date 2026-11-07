// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { applicationStatuses } from '../applications/lists.ts';
import { assignmentStatuses } from '../assessment/lists.ts';
import { configDiffSchema } from '../programme/config.ts';
import { outcomes } from '../programme/lists.ts';
import { reminderSettingDiff, type ReminderSettingInput } from './inputs.ts';
import { reminderMessages } from './messages.ts';
import * as reminders from './routes.ts';

const routes = Object.values(reminders.reminderRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const setting: ReminderSettingInput = {
  draft: { enabled: true, daysBefore: [7, 1], templateId: ID },
  review: { enabled: false, overdueAfterDays: 14, repeatEveryDays: 7, templateId: null },
};

/** Every property name (`key`) or enum value in a schema's JSON Schema, at any depth. */
function words(schema: z.ZodType, want: 'properties' | 'enum'): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === want && want === 'properties' && typeof child === 'object' && child !== null) {
        found.push(...Object.keys(child));
      }
      if (key === want && want === 'enum' && Array.isArray(child)) {
        found.push(...child.map(String));
      }
      walk(child);
    }
  };
  walk(z.toJSONSchema(schema, { io: 'output' }));
  return found;
}

describe('reminder routes', () => {
  it('keep every route rule, for staff who set up programmes in the tenant', () => {
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.programmes.manage',
        scope: 'tenant',
      });
    }
  });

  it('take up to three distinct whole days, and a template for each kind switched on', () => {
    const { body } = reminders.saveReminderSetting;
    expect(body.parse(setting)).toEqual(setting);
    const off = { ...setting, draft: { enabled: false, daysBefore: [], templateId: null } };
    expect(body.safeParse(off).success).toBe(true);
    const messages = (value: unknown) =>
      body.safeParse(value).error?.issues.map((issue) => [issue.path.join('.'), issue.message]);
    expect(messages({ ...setting, draft: { ...setting.draft, daysBefore: [7, 7] } })).toEqual([
      ['draft.daysBefore', reminderMessages.daysBeforeOnce],
    ]);
    expect(messages({ ...setting, draft: { ...setting.draft, daysBefore: [] } })).toEqual([
      ['draft.daysBefore', reminderMessages.daysBefore],
    ]);
    expect(messages({ ...setting, review: { ...setting.review, enabled: true } })).toEqual([
      ['review.templateId', reminderMessages.template],
    ]);
    for (const bad of [
      { ...setting, draft: { ...setting.draft, daysBefore: [14, 7, 3, 1] } },
      { ...setting, draft: { ...setting.draft, daysBefore: [0.5] } },
      { ...setting, review: { ...setting.review, repeatEveryDays: 0 } },
      { ...setting, review: { ...setting.review, overdueAfterDays: 61 } },
      { ...setting, updatedBy: ID },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('record a diff by field path, whatever order the days come in', () => {
    const first = reminderSettingDiff(null, setting);
    expect(configDiffSchema.parse(first)).toEqual(first);
    expect(first).toContainEqual({ path: 'draft.daysBefore', from: null, to: '7,1' });
    const reordered = { ...setting, draft: { ...setting.draft, daysBefore: [1, 7] } };
    expect(reminderSettingDiff(setting, reordered)).toEqual([]);
    const later = { ...setting, review: { ...setting.review, enabled: true, templateId: ID } };
    expect(reminderSettingDiff(setting, later)).toEqual([
      { path: 'review.enabled', from: false, to: true },
      { path: 'review.templateId', from: null, to: ID },
    ]);
  });

  it('carry no status, stage or decision, so a reminder can never change one', () => {
    const forbidden = new Set([
      ...applicationStatuses,
      ...Object.keys(assignmentStatuses),
      ...Object.keys(outcomes),
    ]);
    for (const route of routes) {
      const contract: RouteContract = route;
      const schemas = [contract.body, ...Object.values<unknown>(contract.responses)].filter(
        (schema) => schema instanceof z.ZodType,
      );
      for (const name of schemas.flatMap((schema) => words(schema, 'properties'))) {
        expect(name, route.path).not.toMatch(
          /^(?:status|stages?|stageId|decisions?|eligibility|late|awarded?|released?)$/i,
        );
      }
      for (const value of schemas.flatMap((schema) => words(schema, 'enum'))) {
        expect(forbidden.has(value), `${route.path} ${value}`).toBe(false);
      }
    }
    expect(routes.filter((route) => route.method !== 'GET')).toEqual([
      reminders.saveReminderSetting,
    ]);
  });
});
