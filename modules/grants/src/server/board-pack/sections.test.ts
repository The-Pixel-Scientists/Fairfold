// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a board pack holds, for each kind of requester: the sections built from
// selected applications and the field list computed for the job request. No
// database is needed; the data read is tested with the job.

import { templateVersionSchema, type TemplateVersion } from '@pixel-scientists/domain/documents';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { packFields, showsDecision, type Requester, type SelectedApplication } from './read.ts';
import { buildModel, plain } from './sections.ts';

const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_about',
      title: 'About',
      fields: [
        { id: 'f_aim', type: 'long_text', label: 'Aim', classification: 'internal' },
        {
          id: 'f_contact',
          type: 'short_text',
          label: 'Contact',
          identity: true,
          classification: 'personal',
        },
        {
          id: 'f_health',
          type: 'long_text',
          label: 'Access needs',
          classification: 'special_category',
          audiences: 'aggregate_only',
        },
        {
          id: 'f_kind',
          type: 'single_choice',
          label: 'Kind',
          options: [
            { value: 'hall', label: 'Village hall' },
            { value: 'park', label: 'Park' },
          ],
          classification: 'public',
        },
      ],
    },
  ],
});

const template: TemplateVersion = templateVersionSchema.parse({
  id: '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64',
  templateId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  version: 1,
  kind: 'board_pack',
  audience: 'staff',
  title: 'Board pack',
  mergeFields: ['f_aim', 'f_contact', 'f_health', 'f_kind'],
  body: [
    { type: 'heading', level: 1, text: 'Answers' },
    { type: 'paragraph', content: [{ text: 'Aim: ' }, { field: 'f_aim' }] },
    { type: 'list', ordered: false, items: [[{ text: 'Contact: ' }, { field: 'f_contact' }]] },
    {
      type: 'table',
      header: ['Question', 'Answer'],
      rows: [
        [[{ text: 'Kind' }], [{ field: 'f_kind' }]],
        [[{ text: 'Access' }], [{ field: 'f_health' }]],
      ],
    },
    { type: 'page_break' },
    { type: 'logo', alt: 'A funder' },
  ],
});

const staff: Requester = { audience: 'staff', mayRecordDecisions: true };
const nonRecorder: Requester = { audience: 'staff', mayRecordDecisions: false };
const blind: Requester = { audience: 'blind_reviewer', mayRecordDecisions: false };

function application(change: Partial<SelectedApplication> = {}): SelectedApplication {
  return {
    id: 'a1',
    programmeTitle: 'Community grants',
    roundTitle: 'Spring round',
    status: 'submitted',
    submittedAt: new Date('2026-12-01T10:00:00Z'),
    snapshotId: 's1',
    answers: {
      f_aim: 'Repair the roof <b>now</b>\u0000 https://example.test',
      f_contact: 'Gwŷr Ŵyl',
      f_health: 'Step-free access',
      f_kind: 'hall',
    },
    definition,
    decision: null,
    ...change,
  };
}

const text = (value: unknown): string => JSON.stringify(value);
const organisations = new Map([['a1', 'Harbourside Allotment Society']]);

describe('buildModel', () => {
  const model = buildModel(template, staff, [application()], organisations, 'Europe/London');

  it('has one H1 title and one section per application, headed by its place in the pack', () => {
    expect(model.title).toBe('Board pack');
    expect(model.sections.map((section) => section.heading)).toEqual(['Application 1']);
    expect(text(model)).not.toContain('Community grants Gwŷr');
  });

  it('prints fixed details, then the template body one level below the application heading', () => {
    const [details, heading, aim, contact, answers] = model.sections[0]?.blocks ?? [];
    expect(details).toEqual({
      type: 'table',
      header: ['Detail', 'Value'],
      rows: [
        ['Programme', 'Community grants'],
        ['Round', 'Spring round'],
        ['Status', 'Submitted'],
        ['Submitted', '1 December 2026'],
        ['Organisation', 'Harbourside Allotment Society'],
      ],
    });
    expect(heading).toEqual({ type: 'heading', level: 3, text: 'Answers' });
    expect(aim).toEqual({
      type: 'paragraph',
      text: 'Aim: Repair the roof <b>now</b>  https://example.test',
    });
    expect(contact).toEqual({ type: 'list', ordered: false, items: ['Contact: Gwŷr Ŵyl'] });
    expect(answers).toMatchObject({
      rows: [
        ['Kind', 'Village hall'],
        ['Access', 'Not shown'],
      ],
    });
  });

  it('leaves page breaks and logos out and never prints a special category answer', () => {
    expect(model.sections[0]?.blocks).toHaveLength(5);
    expect(text(model)).not.toContain('Step-free access');
  });

  it('writes text only: control characters become spaces and nothing is kept as markup', () => {
    expect(plain('a\u0000b\u202ec\nd')).toBe('a b c d');
    expect(plain('x'.repeat(30_000))).toHaveLength(20_000);
  });
});

describe('a blind reviewer', () => {
  it('gets no organisation, and no identity answer even if the template names one', () => {
    const model = buildModel(template, blind, [application()], organisations, 'Europe/London');
    expect(text(model)).not.toContain('Harbourside');
    expect(text(model)).not.toContain('Organisation');
    expect(text(model)).not.toContain('Gwŷr');
    expect(model.sections[0]?.blocks[3]).toMatchObject({ items: ['Contact: Not shown'] });
    const { fieldIds } = packFields(template, blind, [application()]);
    expect(fieldIds).not.toContain('party.organisation_snapshot.name');
    expect(fieldIds).not.toContain('f_contact');
  });
});

describe('field list', () => {
  it('holds the columns and answers the requester may have, with each answer class', () => {
    const { fieldIds, answerClasses } = packFields(template, staff, [application()]);
    expect(fieldIds).toEqual([
      'grants.programme.title',
      'grants.round.title',
      'grants.application.status',
      'grants.application.submitted_at',
      'party.organisation_snapshot.name',
      'f_aim',
      'f_contact',
      'f_kind',
    ]);
    expect(answerClasses).toEqual({ f_aim: 'internal', f_contact: 'personal', f_kind: 'public' });
  });

  it('never lists a special category or aggregate-only answer, whoever asks', () => {
    for (const requester of [staff, nonRecorder, blind]) {
      expect(packFields(template, requester, [application()]).fieldIds).not.toContain('f_health');
    }
  });
});

describe('unreleased decisions', () => {
  const unreleased = application({
    decision: { outcome: 'accepted', amountMinor: '1500000', released: false },
  });
  const released = application({
    decision: { outcome: 'accepted', amountMinor: '1500000', released: true },
  });

  it('read to a member who cannot record them exactly as no decision does', () => {
    expect(showsDecision(nonRecorder, unreleased)).toBe(false);
    const asked = (applications: SelectedApplication[], requester: Requester) => ({
      model: buildModel(template, requester, applications, organisations, 'Europe/London'),
      fields: packFields(template, requester, applications),
    });
    expect(asked([unreleased], nonRecorder)).toEqual(asked([application()], nonRecorder));
  });

  it('show to a member who records decisions, with the outcome and amount', () => {
    const model = buildModel(template, staff, [unreleased], organisations, 'Europe/London');
    const fields = packFields(template, staff, [unreleased]);
    const details = model.sections[0]?.blocks[0];
    const rows = details?.type === 'table' ? details.rows : [];
    expect(rows).toContainEqual(['Decision', 'Accepted']);
    expect(rows).toContainEqual(['Amount', '£15,000']);
    expect(fields.fieldIds).toContain('grants.decision.amount_minor');
  });

  it('show to everyone once released', () => {
    const model = buildModel(template, nonRecorder, [released], organisations, 'Europe/London');
    expect(text(model)).toContain('Accepted');
  });
});
