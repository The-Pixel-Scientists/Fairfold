// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The email template routes through the whole API against the test
// database, as app_api: a new version for each template that changes, the
// merge field allowlist, the configuration versions and the audit log.

import { defaultEmailTemplates, programmeMessages } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  answer,
  rowsOf,
  startProgrammeApi,
  storedVersions,
  type Problem,
  type ProgrammeApi,
} from './programme-api.ts';
import { events } from './settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

interface Template {
  subject: string;
  body: string;
  version: number;
}

type Templates = Record<'accepted' | 'waitlisted' | 'declined', Template>;

let t: ProgrammeApi;

beforeAll(async () => {
  t = await startProgrammeApi('41013');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const url = (programmeId: string) => `/console/programmes/${programmeId}/email-templates`;

const storedVersionsOf = (programmeId: string) =>
  rowsOf<{ outcome: string; version: number; created_by: string }>(
    t.tenantA,
    `SELECT outcome, version, created_by FROM grants.email_template_version
      WHERE programme_id = $1 ORDER BY outcome, version`,
    [programmeId],
  );

describe('reading the templates', () => {
  it('gives version 1 of each outcome’s default for a new programme', async () => {
    const programme = await t.aProgramme();

    expect(await answer(t.send(t.managerA, 'GET', url(programme.id)))).toEqual({
      accepted: { ...defaultEmailTemplates.accepted, version: 1 },
      waitlisted: { ...defaultEmailTemplates.waitlisted, version: 1 },
      declined: { ...defaultEmailTemplates.declined, version: 1 },
    });
  });
});

describe('saving the templates', () => {
  it('writes a new version for each template that changed, with a configuration version and audit events', async () => {
    const programme = await t.aProgramme();
    const body = {
      ...defaultEmailTemplates,
      accepted: {
        subject: '{{programme_title}}: your grant of {{award_amount}}',
        body: 'Dear {{ given_name }},\n\nWe will pay {{award_amount}} to {{organisation_name}}.\n\n{{portal_link}}',
      },
      declined: {
        ...defaultEmailTemplates.declined,
        body: 'Dear {{given_name}},\n\nNot this time.',
      },
    };

    const saved = await answer<Templates>(t.send(t.ada, 'PUT', url(programme.id), body));

    expect(saved).toEqual({
      accepted: { ...body.accepted, version: 2 },
      waitlisted: { ...defaultEmailTemplates.waitlisted, version: 1 },
      declined: { ...body.declined, version: 2 },
    });
    expect(await answer(t.send(t.managerA, 'GET', url(programme.id)))).toEqual(saved);
    expect(await storedVersionsOf(programme.id)).toEqual([
      { outcome: 'accepted', version: 1, created_by: t.managerA.membershipId },
      { outcome: 'accepted', version: 2, created_by: t.ada.membershipId },
      { outcome: 'declined', version: 1, created_by: t.managerA.membershipId },
      { outcome: 'declined', version: 2, created_by: t.ada.membershipId },
      { outcome: 'waitlisted', version: 1, created_by: t.managerA.membershipId },
    ]);

    const versions = await storedVersions(t.tenantA, 'grants.programme', programme.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[1]).toMatchObject({ author_id: t.ada.membershipId });
    expect(versions[1]?.diff.changes).toEqual([
      {
        path: 'emailTemplates.accepted.subject',
        from: defaultEmailTemplates.accepted.subject,
        to: body.accepted.subject,
      },
      {
        path: 'emailTemplates.accepted.body',
        from: defaultEmailTemplates.accepted.body,
        to: body.accepted.body,
      },
      {
        path: 'emailTemplates.declined.body',
        from: defaultEmailTemplates.declined.body,
        to: body.declined.body,
      },
    ]);
    const audit = (await events(t.tenantA, 'grants.programme.email_templates_changed')).filter(
      (row) => row.entity_id === programme.id,
    );
    // Both events are in one transaction, so their order is not defined.
    const byOutcome = (rows: typeof audit) =>
      rows
        .map((row) => row.changes)
        .sort((a, b) =>
          String(a['grants.email_template_version.outcome']?.after).localeCompare(
            String(b['grants.email_template_version.outcome']?.after),
          ),
        );
    expect(byOutcome(audit)).toEqual([
      {
        'grants.email_template_version.outcome': { after: 'accepted' },
        'grants.email_template_version.version': { before: 1, after: 2 },
      },
      {
        'grants.email_template_version.outcome': { after: 'declined' },
        'grants.email_template_version.version': { before: 1, after: 2 },
      },
    ]);
    expect(audit.every((row) => row.actor_id === t.ada.membershipId)).toBe(true);
  });

  it('writes nothing for templates as they are', async () => {
    const programme = await t.aProgramme();

    const saved = await answer<Templates>(
      t.send(t.managerA, 'PUT', url(programme.id), defaultEmailTemplates),
    );

    expect(saved.accepted.version).toBe(1);
    expect(await storedVersionsOf(programme.id)).toHaveLength(3);
    expect(await storedVersions(t.tenantA, 'grants.programme', programme.id)).toHaveLength(1);
  });

  it('refuses a merge field outside the allowlist, naming the template, and changes nothing', async () => {
    const programme = await t.aProgramme();
    const changed = (outcome: keyof Templates, part: 'subject' | 'body', text: string) => ({
      ...defaultEmailTemplates,
      [outcome]: { ...defaultEmailTemplates[outcome], [part]: text },
    });
    const cases: [object, string][] = [
      [changed('accepted', 'body', 'Dear {{email}}'), 'body.accepted.body'],
      [changed('accepted', 'subject', '{{programme_title}} {{score}}'), 'body.accepted.subject'],
      // The amount is released in the accepted email only.
      [changed('waitlisted', 'body', 'You could get {{award_amount}}'), 'body.waitlisted.body'],
      [changed('declined', 'subject', '{{award_amount}}'), 'body.declined.subject'],
      [changed('declined', 'body', 'Dear {{given_name'), 'body.declined.body'],
      [changed('declined', 'body', 'Dear {{ GIVEN_NAME }}'), 'body.declined.body'],
    ];
    for (const [body, field] of cases) {
      const response = await t.send(t.managerA, 'PUT', url(programme.id), body);
      expect(response.statusCode, field).toBe(400);
      const problem = response.json<Problem>();
      expect(problem.errors, field).toEqual([{ field, message: programmeMessages.mergeFields }]);
      expect(JSON.stringify(problem)).not.toContain('score');
    }
    expect(await storedVersionsOf(programme.id)).toHaveLength(3);
    expect(await storedVersions(t.tenantA, 'grants.programme', programme.id)).toHaveLength(1);
  });

  it('refuses an empty subject or body, hidden characters, a missing template and extra keys', async () => {
    const programme = await t.aProgramme();
    const { accepted } = defaultEmailTemplates;
    const cases: [object, string, string | undefined][] = [
      [
        { ...defaultEmailTemplates, accepted: { ...accepted, subject: ' ' } },
        'body.accepted.subject',
        programmeMessages.subject,
      ],
      [
        { ...defaultEmailTemplates, accepted: { ...accepted, body: '' } },
        'body.accepted.body',
        programmeMessages.body,
      ],
      [
        { ...defaultEmailTemplates, accepted: { ...accepted, subject: 'Hello\nthere' } },
        'body.accepted.subject',
        programmeMessages.hiddenCharacters,
      ],
      [
        { ...defaultEmailTemplates, accepted: { ...accepted, body: 'Hi‮' } },
        'body.accepted.body',
        programmeMessages.hiddenCharactersText,
      ],
      [{ accepted, waitlisted: defaultEmailTemplates.waitlisted }, 'body.declined', undefined],
      [{ ...defaultEmailTemplates, rejected: accepted }, 'body.rejected', undefined],
      [
        { ...defaultEmailTemplates, accepted: { ...accepted, version: 7 } },
        'body.accepted.version',
        undefined,
      ],
    ];
    for (const [body, field, message] of cases) {
      const response = await t.send(t.managerA, 'PUT', url(programme.id), body);
      expect(response.statusCode, field).toBe(400);
      const found = response.json<Problem>().errors?.find((error) => error.field === field);
      expect(found, field).toBeDefined();
      if (message !== undefined) expect(found?.message).toBe(message);
    }
    expect(await storedVersionsOf(programme.id)).toHaveLength(3);
  });

  it('answers 404 for another tenant’s programme', async () => {
    const programme = await t.aProgramme();

    expect((await t.send(t.managerB, 'GET', url(programme.id))).statusCode).toBe(404);
    expect(
      (await t.send(t.managerB, 'PUT', url(programme.id), defaultEmailTemplates)).statusCode,
    ).toBe(404);
  });
});
