// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Exports made by a job. Eight applications whose text starts with each
// formula-leading character are exported as CSV through a saved view: every
// such cell leaves prefixed with a single quote and the file is an
// attachment that may not be sniffed. No staff note or message text is in it.
// A board pack of selected applications downloads as a PDF for the member who
// asked and for no one else: another member of the funder and the second
// funder get "not found" for both jobs. The requests and the downloads are
// in the audit log (rule 4).
//
// Checking names inside the PDF needs text extraction, which would be a new
// dependency; this spec checks the type, the disposition and who may read it.
//
// It reads what the journey left, so it runs after the journey.

import { signInStaff, stepUp, type Api } from '../support/api.ts';
import { applyThroughTheApi, groups } from '../support/applications.ts';
import { auditEvents } from '../support/audit.ts';
import { need } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';
import { parseCsv, startsAsFormula } from './csv.ts';
import {
  auditReader,
  call,
  create,
  fileRoute,
  MESSAGE,
  made,
  needsJourney,
  readyFile,
} from './steps.ts';

inOrder();
needsJourney();

const RUN = String(Date.now());
const NOTE = 'qzx-note-export: call before the panel';

/** One text for each way a cell can start a formula, and the way a spreadsheet may skip it. */
const payloads = [
  '=qzx-f0',
  '+qzx-f1',
  '-qzx-f2',
  '@qzx-f3',
  '\tqzx-f4',
  '\rqzx-f5',
  '  =qzx-f6',
  '＝qzx-f7',
];

let manager: Api;
let reader: Api;
const applicationIds: string[] = [];
let viewId = '';
let csvRequest = '';
let packRequest = '';

test.describe('CSV export and board pack', () => {
  test.beforeAll(async () => {
    test.setTimeout(600_000);
    manager = await signInStaff('northfield', 'manager');
    reader = await auditReader();

    let fieldId = '';
    for (const [index, payload] of payloads.entries()) {
      const template = groups[index % groups.length] ?? groups[0];
      if (template === undefined) throw new Error('The demo has no groups.');
      const { api, applicationId } = await applyThroughTheApi({
        ...template,
        name: `formula${String(index)}`,
        organisation: `Fernhill Formula ${String(index)} ${RUN}`,
        charityNumber: `13${RUN.slice(-4)}${String(index)}`,
        projectWords: payload,
      });
      if (fieldId === '') {
        const round = await api.ok<{
          form: { definition: { sections: { fields: { id: string; type: string }[] }[] } };
        }>('GET', `/portal/rounds/${need('roundId')}`);
        fieldId =
          round.form.definition.sections
            .flatMap(({ fields }) => fields)
            .find(({ type }) => type === 'long_text')?.id ?? '';
      }
      applicationIds.push(applicationId);
      await api.dispose();
    }
    const first = applicationIds[0] ?? '';
    await create(manager, `/console/submissions/${first}/notes`, { body: NOTE });
    await create(manager, `/console/submissions/${first}/messages`, { body: MESSAGE });

    const view = await made<{ id: string }>(
      create(manager, '/console/saved-views', {
        name: `qzx formulas ${RUN}`,
        filter: { roundId: need('roundId') },
        sort: { by: 'submittedAt', direction: 'asc' },
        columns: [
          { kind: 'column', id: 'organisation' },
          { kind: 'answer', fieldId },
        ],
      }),
    );
    viewId = view.id;
  });

  test.afterAll(async () => {
    if (viewId !== '') await manager.send('DELETE', `/console/saved-views/${viewId}`);
    await Promise.all([manager.dispose(), reader.dispose()]);
  });

  test('a request that names a tenant, an actor or a column is refused and makes no job', async () => {
    await stepUp(manager, 'manager');
    for (const extra of ['tenantId', 'tenant_id', 'actorId', 'membershipId', 'columns']) {
      const answer = await create(manager, '/console/csv-exports', { viewId, [extra]: viewId });
      expect([400, 422], extra).toContain(answer.status);
    }
  });

  test('the CSV leaves every formula-leading cell prefixed with a single quote, as an attachment', async () => {
    const before = (await auditEvents(reader, { action: 'grants.export.requested' })).length;
    await stepUp(manager, 'manager');
    const accepted = await made<{ requestId: string }>(
      create(manager, '/console/csv-exports', { viewId }),
      202,
    );
    csvRequest = accepted.requestId;
    const fileId = await readyFile(manager, `/console/csv-exports/${csvRequest}`);

    const file = await manager.send('GET', fileRoute(fileId));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    const cells = parseCsv(file.text).flat();
    for (const payload of payloads) {
      const marker = payload.trim().replace(/^[=+\-@＝]/, '');
      const cell = cells.find((candidate) => candidate.includes(marker));
      expect(cell, `the CSV has no cell with ${marker}`).toBeDefined();
      const allowed = startsAsFormula(payload.trim())
        ? [`'${payload}`, `'${payload.trim()}`]
        : [payload, payload.trim()];
      expect(allowed, `the cell for ${JSON.stringify(payload)}`).toContain(cell);
    }
    for (const cell of cells) {
      if (cell.startsWith("'")) continue;
      expect(startsAsFormula(cell), `an unescaped formula cell: ${JSON.stringify(cell)}`).toBe(
        false,
      );
    }
    expect(file.text).not.toContain('qzx-note');
    expect(file.text).not.toContain('qzx-message');

    const after = await auditEvents(reader, { action: 'grants.export.requested' });
    expect(after).toHaveLength(before + 1);
    expect(JSON.stringify(after)).not.toContain('qzx-f');
  });

  test('a board pack downloads as a PDF for the requester, and the request is audited', async () => {
    const before = (await auditEvents(reader, { action: 'grants.board_pack.requested' })).length;
    await stepUp(manager, 'manager');
    const accepted = await made<{ requestId: string }>(
      create(manager, '/console/board-packs', { applicationIds: applicationIds.slice(0, 2) }),
      202,
    );
    packRequest = accepted.requestId;
    const fileId = await readyFile(manager, `/console/board-packs/${packRequest}`);

    const file = await manager.send('GET', fileRoute(fileId));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');

    expect(await auditEvents(reader, { action: 'grants.board_pack.requested' })).toHaveLength(
      before + 1,
    );
    const downloads = await auditEvents(reader, { action: 'platform.file.downloaded' });
    expect(downloads.map(({ entityId }) => entityId)).toContain(fileId);
  });

  test('another member and the second funder get not found for both jobs', async () => {
    const colleague = await signInStaff('northfield', 'colleague');
    await stepUp(colleague, 'colleague');
    const east = await signInStaff('eastmoor', 'eastManager');
    await stepUp(east, 'eastManager');
    for (const [who, api] of [
      ['colleague', colleague],
      ['eastManager', east],
    ] as const) {
      for (const path of [
        `/console/csv-exports/${csvRequest}`,
        `/console/board-packs/${packRequest}`,
      ]) {
        const answer = await call(api, 'GET', path);
        expect(answer.status, `${who} ${path}`).toBe(404);
        expect(answer.text, `${who} ${path}`).not.toContain(csvRequest);
      }
    }
    const mine = await manager.ok<{ fileId: string }>('GET', `/console/csv-exports/${csvRequest}`);
    expect([403, 404]).toContain((await call(colleague, 'GET', fileRoute(mine.fileId))).status);
    expect(await call(east, 'GET', fileRoute(mine.fileId))).toMatchObject({ status: 404 });

    const pack = await call(east, 'POST', '/console/board-packs', {
      applicationIds: applicationIds.slice(0, 1),
    });
    expect(pack.status).toBe(404);
    await Promise.all([colleague.dispose(), east.dispose()]);
  });

  test('a board pack of an unknown application is refused as a whole', async () => {
    await stepUp(manager, 'manager');
    const answer = await create(manager, '/console/board-packs', {
      applicationIds: [applicationIds[0] ?? '', '00000000-0000-4000-8000-000000000000'],
    });
    expect(answer.status).toBe(404);
  });
});
