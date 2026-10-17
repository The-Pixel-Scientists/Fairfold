// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The email template routes' handlers. A template is never changed: a save
// writes a new version of each outcome's template that differs, so a release
// can name the version it sent (ADR 0020). The merge fields were checked
// against the allowlist when the request was read.

import {
  configDiff,
  outcomeIds,
  type EmailTemplates,
  type EmailTemplatesInput,
} from '../../contracts/index.ts';
import { recordConfig } from './change.ts';
import type { Args, GrantsDependencies, ProgrammeParams } from './context.ts';
import { programmeExists, readTemplates } from './read.ts';
import { grantsDb } from './tables.ts';
import { templateValues } from './values.ts';

export function templateHandlers(deps: GrantsDependencies) {
  async function getEmailTemplates({ tx, input }: Args<ProgrammeParams>): Promise<EmailTemplates> {
    const { programmeId } = input.params;
    if (!(await programmeExists(tx, programmeId))) throw deps.notFound();
    return readTemplates(tx, programmeId);
  }

  async function setEmailTemplates({
    tx,
    context,
    input,
  }: Args<ProgrammeParams & { body: EmailTemplatesInput }>): Promise<EmailTemplates> {
    const { programmeId } = input.params;
    if (!(await programmeExists(tx, programmeId, true))) throw deps.notFound();

    const before = await readTemplates(tx, programmeId);
    const diff = configDiff(templateValues(before), templateValues(input.body));
    const changed = outcomeIds.filter((outcome) =>
      diff.some(({ path }) => path.startsWith(`emailTemplates.${outcome}.`)),
    );
    if (changed.length === 0) return before;

    await grantsDb(tx)
      .insertInto('grants.email_template_version')
      .values((eb) =>
        changed.map((outcome) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          programme_id: programmeId,
          outcome,
          version: before[outcome].version + 1,
          subject: input.body[outcome].subject,
          body: input.body[outcome].body,
          created_by: context.membership.id,
        })),
      )
      .execute();
    await recordConfig(deps, tx, context, 'grants.programme', programmeId, diff);
    for (const outcome of changed) {
      const { version } = before[outcome];
      await context.audit.record({
        action: 'grants.programme.email_templates_changed',
        entityId: programmeId,
        changes: {
          'grants.email_template_version.outcome': { after: outcome },
          'grants.email_template_version.version': { before: version, after: version + 1 },
        },
      });
    }
    return readTemplates(tx, programmeId);
  }

  return { getEmailTemplates, setEmailTemplates };
}
