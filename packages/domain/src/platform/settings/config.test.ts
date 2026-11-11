// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { moduleIds } from '../modules.ts';
import { configDiffSchemas, configEntityTypes } from './config.ts';

const SHA256 = 'a'.repeat(64);
const ITEM = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';

describe('configuration entity types', () => {
  it('are named <module>.<entity>, as app.config_version checks', () => {
    for (const type of configEntityTypes) {
      expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(moduleIds).toContain(type.split('.')[0]);
    }
    expect(Object.keys(configDiffSchemas)).toEqual([...configEntityTypes]);
  });

  it('are exactly the platform settings and the tools, so an unknown type has no diff', () => {
    expect(configEntityTypes).toEqual([
      'platform.tenant',
      'platform.theme',
      'platform.module',
      'platform.retention',
      'platform.embed_origins',
      'crm.segment',
      'assure.checklist',
      'forms.form',
      'insight.report_definition',
      'insight.disclosure_rule',
      'impact.framework',
    ]);
    for (const type of ['crm.list', 'grants.programme', '__proto__', 'toString']) {
      expect(Object.hasOwn(configDiffSchemas, type), type).toBe(false);
    }
  });
});

describe('configuration diffs', () => {
  it('list each changed field with its old and new values', () => {
    const cases = {
      'platform.tenant': [
        { field: 'name', from: 'Northfield', to: 'Northfield Trust' },
        { field: 'fiscalYearStartMonth', from: 4, to: 1 },
      ],
      'platform.theme': [
        { field: 'brandColour', from: '#1f4bb8', to: '#7a2e8c' },
        { field: 'logo', from: null, to: { type: 'image/png', sha256: SHA256 } },
        { field: 'token', token: 'dark.colorAccent', from: null, to: '#ececea' },
        { field: 'token', token: 'radii.radiusSm', from: 0.25, to: 0 },
        { field: 'token', token: 'font', from: 'atkinson', to: 'system' },
        { field: 'token', token: 'type.text2xlLineHeight', from: 2, to: null },
        { field: 'tokens', from: 'unusable', to: null },
      ],
      'platform.module': [{ field: 'enabled', from: true, to: false }],
      'platform.retention': [{ field: 'days', from: 365, to: 730 }],
      'platform.embed_origins': [{ field: 'origin', from: null, to: 'https://www.example.org' }],
      'crm.segment': [
        { path: 'name', from: 'Donors', to: 'Regular donors' },
        { path: `filters.${ITEM}.operator`, from: null, to: 'equals' },
      ],
      'assure.checklist': [
        { path: `items.${ITEM}.label`, from: null, to: 'Safeguarding policy seen' },
        { path: 'items.f_policy.required', from: false, to: true },
      ],
      'forms.form': [
        { field: 'respondents', from: 'signed_in', to: 'both' },
        { field: 'closesAt', from: null, to: '2026-12-01T17:00:00Z' },
        { field: 'retentionMonths', from: 24, to: 12 },
      ],
      'insight.report_definition': [
        { path: 'source', from: 'applications', to: 'awards' },
        { path: `groupBy.${ITEM}`, from: null, to: 'region' },
      ],
      'insight.disclosure_rule': [{ field: 'threshold', from: 10, to: 15 }],
      'impact.framework': [
        { path: 'name', from: null, to: 'Community outcomes' },
        { path: `outcomes.${ITEM}.name`, from: 'Less isolation', to: 'Fewer people isolated' },
        { path: `indicators.${ITEM}.unit`, from: null, to: 'people' },
      ],
    } as const;
    for (const type of configEntityTypes) {
      expect(configDiffSchemas[type].parse(cases[type])).toEqual(cases[type]);
    }
  });

  it('refuse empty diffs, unknown fields, mismatched values and logo bytes', () => {
    const refused = {
      'platform.tenant': [[], [{ field: 'slug', from: 'a', to: 'b' }]],
      'platform.theme': [
        [{ field: 'brandColour', from: '#1f4bb8', to: 'red' }],
        [{ field: 'logo', from: null, to: { type: 'image/png', sha256: SHA256, bytes: 'iVBO' } }],
        [{ field: 'logo', from: null, to: { type: 'image/svg+xml', sha256: SHA256 } }],
        [{ field: 'token', token: 'light.colorBrand', from: null, to: '#000000' }],
        [{ field: 'token', token: '__proto__', from: null, to: '#000000' }],
        [{ field: 'token', token: 'light.colorInk', from: null, to: 'red' }],
        [{ field: 'token', token: 'font', from: 'atkinson', to: 'Comic Sans' }],
        [{ field: 'token', token: 'font', from: null, to: 'system', css: '} body {' }],
        [{ field: 'tokens', from: { 'light.colorInk': '#ffffff' }, to: null }],
        [{ field: 'tokens', from: 'unusable', to: {} }],
      ],
      'platform.module': [[], [{ field: 'enabled', from: 'on', to: 'off' }]],
      'platform.retention': [
        [],
        [{ field: 'days', from: 365, to: 0 }],
        [{ field: 'days', from: 365, to: 36_501 }],
        [{ field: 'days', from: 365, to: 30.5 }],
        [{ field: 'policy', from: 'audit', to: 'files' }],
        [{ field: 'days', from: 365, to: 730, partyId: '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64' }],
        [
          { field: 'days', from: 365, to: 730 },
          { field: 'days', from: 730, to: 1095 },
        ],
      ],
      'platform.embed_origins': [
        [],
        [{ field: 'origin', from: null, to: null }],
        [{ field: 'origin', from: 'https://a.example.org', to: 'https://b.example.org' }],
        [{ field: 'origin', from: null, to: 'https://*.example.org' }],
        [{ field: 'origin', from: null, to: 'https://www.example.org', createdBy: ITEM }],
        [
          { field: 'origin', from: null, to: 'https://a.example.org' },
          { field: 'origin', from: null, to: 'https://b.example.org' },
        ],
      ],
      'crm.segment': [
        [],
        [{ path: `filters.${ITEM}.value`, from: null, to: 'Jo Bloggs' }],
        [{ path: 'name', from: 'a', to: 'b', person: 'Jo Bloggs' }],
        [{ path: 'members', from: null, to: 3 }],
      ],
      'assure.checklist': [
        [{ path: 'items.0.label', from: null, to: 'Position, not id' }],
        [{ path: `items.${ITEM}.answer`, from: null, to: 'yes' }],
        [{ path: '__proto__', from: null, to: 'x' }],
        [{ path: 'name', from: null, to: { label: 'nested' } }],
      ],
      'forms.form': [
        [],
        [{ field: 'respondents', from: 'signed_in', to: 'everyone' }],
        [{ field: 'title', from: 'a', to: 'b', answers: {} }],
        [{ field: 'owner', from: null, to: 'Jo Bloggs' }],
        [{ field: 'retentionMonths', from: 12, to: 0 }],
      ],
      'insight.report_definition': [
        [{ path: `filters.${ITEM}.value`, from: null, to: 'ZZ99 9ZZ' }],
        [{ path: 'results', from: null, to: 3 }],
      ],
      'insight.disclosure_rule': [
        [],
        [{ field: 'threshold', from: 10, to: 0 }],
        [{ field: 'floor', from: 10, to: 5 }],
        [{ field: 'threshold', from: 10, to: 15, reason: 'x' }],
      ],
      'impact.framework': [
        [],
        [{ path: `indicators.${ITEM}.value`, from: null, to: 12 }],
        [{ path: 'outcomes.f_policy.name', from: null, to: 'x' }],
        [{ path: `results.${ITEM}`, from: null, to: 3 }],
      ],
    };
    for (const type of configEntityTypes) {
      for (const diff of refused[type]) {
        expect(configDiffSchemas[type].safeParse(diff).success, JSON.stringify(diff)).toBe(false);
      }
    }
  });
});
