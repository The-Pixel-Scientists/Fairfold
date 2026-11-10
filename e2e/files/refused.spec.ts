// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Files the platform must refuse, and never serve: the antivirus test string,
// an encrypted document, a web page named as a PDF, and an upload that names a
// tenant or an actor (rule 6). Then one clean file, downloaded as an
// attachment with the bytes it went in with. The applicant is this spec's own,
// with an application of its own, so the demo's data is left as it was.
//
// It reads what the journey left (the round and the accounts question), so it
// runs after the journey. Folders run in name order, so this one runs first on
// a fresh stack and skips itself until the journey's state is there.

import { createHash, randomUUID } from 'node:crypto';

import { fileRefusalMessages } from '../../packages/domain/src/files/index.ts';
import { accountsPdf, virusPdf } from '../fixtures/files.ts';
import { type Api } from '../support/api.ts';
import { applicantWithOrganisation, groups } from '../support/applications.ts';
import { readState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';
import { encryptedDocument, pageNamedAsPdf } from './samples.ts';

inOrder();
test.skip(
  readState().ids['accountsFieldId'] === undefined,
  'The journey has not run: pnpm test:stack --project journey --workers 1 runs it first.',
);

let own: { api: Api; applicationPath: string } | undefined;

function session(): NonNullable<typeof own> {
  if (own === undefined) throw new Error('The first test makes the applicant.');
  return own;
}

const ids = (): Record<string, string> => readState().ids;

test.describe('files that must be refused and never served', () => {
  test('the applicant starts an application of their own', async () => {
    const [template] = groups;
    if (template === undefined) throw new Error('The demo has no groups.');
    const { api, organisationId } = await applicantWithOrganisation({
      ...template,
      name: 'files1',
      givenName: 'Files',
      familyName: 'One',
      organisation: 'Fernhill Files Group',
      charityNumber: '1209101',
    });
    const started = await api.ok<{ id: string }>(
      'POST',
      `/portal/rounds/${ids()['roundId'] ?? ''}/applications`,
      { json: { organisationId } },
    );
    own = { api, applicationPath: `/portal/applications/${started.id}` };
  });

  test('refuses the test virus, an encrypted document and a page named as a PDF', async () => {
    const { api, applicationPath } = session();
    const upload = (name: string, bytes: Buffer) =>
      api.send('POST', `${applicationPath}/fields/${ids()['accountsFieldId'] ?? ''}/files`, {
        file: { name, bytes },
      });
    const cases = [
      ['Fernhill budget 2026.pdf', virusPdf(), fileRefusalMessages.infected],
      ['Fernhill & sons budget.docx', encryptedDocument(), fileRefusalMessages.not_checked],
      ['Fernhill budget.pdf', pageNamedAsPdf(), fileRefusalMessages.type_not_allowed],
    ] as const;
    for (const [name, bytes, detail] of cases) {
      const answer = await upload(name, bytes);
      expect(answer.status, name).toBeGreaterThanOrEqual(400);
      expect(answer.status, name).toBeLessThan(500);
      expect((answer.json as { detail?: string }).detail, name).toBe(detail);
      // A problem says what went wrong and echoes nothing that was sent.
      expect(answer.text, name).not.toContain(name);
    }

    const { attachments } = await api.ok<{ attachments: unknown[] }>(
      'GET',
      `${applicationPath}/files`,
    );
    expect(attachments).toEqual([]);
  });

  test('refuses an upload that names a tenant or an actor, and a download that does', async () => {
    const { api, applicationPath } = session();
    const field = ids()['accountsFieldId'] ?? '';
    for (const name of ['tenantId', 'tenant_id', 'actorId', 'membershipId']) {
      const answer = await api.send('POST', `${applicationPath}/fields/${field}/files`, {
        query: { [name]: randomUUID() },
        file: { name: 'Fernhill budget 2026.pdf', bytes: accountsPdf() },
      });
      expect([400, 422], `${name} on an upload`).toContain(answer.status);
    }
    const unknown = await api.send('GET', `${applicationPath}/files/${randomUUID()}`);
    expect(unknown.status).toBe(404);
    const named = await api.send('GET', `${applicationPath}/files/${randomUUID()}`, {
      query: { tenantId: randomUUID() },
    });
    expect([400, 404, 422]).toContain(named.status);

    const { attachments } = await api.ok<{ attachments: unknown[] }>(
      'GET',
      `${applicationPath}/files`,
    );
    expect(attachments).toEqual([]);
  });

  test('keeps a clean file, and serves it as an attachment with the bytes it had', async () => {
    const { api, applicationPath } = session();
    const bytes = accountsPdf();
    const name = 'Fernhill budget 2026.pdf';
    const sent = await api.send(
      'POST',
      `${applicationPath}/fields/${ids()['accountsFieldId'] ?? ''}/files`,
      { file: { name, bytes } },
    );
    expect(sent.status).toBe(201);

    const { attachments } = await api.ok<{ attachments: { id: string; name: string }[] }>(
      'GET',
      `${applicationPath}/files`,
    );
    expect(attachments.map((file) => file.name)).toEqual([name]);

    const got = await api.send('GET', `${applicationPath}/files/${attachments[0]?.id ?? ''}`);
    expect(got.status).toBe(200);
    expect(got.headers['content-disposition']).toMatch(/^attachment;/);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-type']).toBe('application/pdf');
    expect(createHash('sha256').update(got.bytes).digest('hex')).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
  });
});
