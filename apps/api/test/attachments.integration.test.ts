// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The attachment routes through the whole API against the test database, as
// app_api, and the development SeaweedFS and clamd (docker compose -f
// infra/compose/compose.dev.yaml up -d --wait, and `node scripts/dev.ts
// bucket` once for this worktree's bucket): who may attach, list, remove and
// download, what is refused and why, what staff are shown, and what each
// step leaves in the tables and the audit log.
//
// The EICAR test string is built at run time from parts, so no file holds it.

import { createHash, randomUUID } from 'node:crypto';

import { MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import type {
  Application,
  AttachmentList,
  AttachmentView,
} from '@pixel-scientists/grants/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn, insertRow } from '../../../packages/db/test/tenants.ts';
import { createFileService, loadFileSettings } from '../src/platform/files/index.ts';
import {
  charity,
  complete,
  haveWeb,
  startApplicationsApi,
  type ApplicationsApi,
} from './applications-api.ts';
import { question, title } from './forms-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { events, png, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each upload scans, writes and records in one request, which is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const accounts = question('f_accounts', 'file', 'Your accounts', { required: true });
const photos = question('f_photos', 'file', 'Photos', {
  maxFiles: 3,
  allowedTypes: ['image/png', 'image/jpeg'],
});
const papers = question('f_papers', 'file', 'Internal papers', {
  audiences: ['applicant'],
  maxFiles: 10,
});
const quotes = question('f_quotes', 'file', 'Quotes', {
  conditions: [{ field: 'f_haveweb', equals: true }],
});
const formFields = [charity, title, haveWeb, accounts, photos, papers, quotes];

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi(
    '41033',
    undefined,
    createFileService(loadFileSettings(process.env)),
  );
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** A document that starts like a PDF, with a body of the given text. */
const pdf = (body = randomUUID()) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
  );

/** The EICAR test string, from parts so that no file on disk holds it. */
const eicar = (): string =>
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');

type Open = Awaited<ReturnType<typeof t.openRound>>;

const openForm = () => t.openRound(t.managerA, formFields);

async function aDraft(open?: Open, member: Member = t.ann): Promise<Application> {
  return t.aDraft(member, (open ?? (await openForm())).round.id);
}

const attach = (
  member: Member | undefined,
  id: string,
  fieldId: string,
  name: string,
  bytes: Buffer,
) => t.upload(member, t.path(id, `/fields/${fieldId}/files`), name, bytes);

const view = (response: LightMyRequestResponse) => {
  expect(response.statusCode, response.body).toBe(201);
  return response.json<AttachmentView>();
};

const refused = (response: LightMyRequestResponse) => {
  expect(response.statusCode, response.body).toBe(400);
  return response.json<Problem>();
};

const listOf = (member: Member, id: string) =>
  answer<AttachmentList>(t.send(member, 'GET', t.path(id, '/files')));

const links = (id: string) =>
  t.rows<{ field_id: string; file_id: string }>(
    'SELECT field_id, file_id FROM grants.application_file WHERE application_id = $1 ORDER BY created_at',
    [id],
  );

const fileCount = async () =>
  Number((await t.rows<{ n: string }>('SELECT count(*) AS n FROM app.file'))[0]?.n);

const downloads = async (fileId: string) =>
  (await events(t.tenantA, 'platform.file.downloaded')).filter(
    (event) => event.entity_id === fileId,
  );

/** A draft with the required answers and file, submitted. */
async function submittedWith(open: Open, ...more: [string, string, Buffer][]) {
  const draft = await aDraft(open);
  const first = view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
  const others: AttachmentView[] = [];
  for (const [fieldId, name, bytes] of more) {
    others.push(view(await attach(t.ann, draft.id, fieldId, name, bytes)));
  }
  const ready = await t.saved(t.ann, draft, complete);
  await answer(t.submit(t.ann, ready));
  return { id: draft.id, first, others };
}

describe('attaching a file', () => {
  it('links a clean file, answers 201 with its view, and audits the upload without the name', async () => {
    const draft = await aDraft();
    const bytes = pdf();
    const name = `Accounts ${randomUUID()}.pdf`;
    const file = view(await attach(t.ann, draft.id, 'f_accounts', name, bytes));

    expect(file).toEqual({
      id: expect.any(String) as string,
      name,
      type: 'application/pdf',
      bytes: bytes.length,
      uploadedAt: expect.stringMatching(/Z$/) as string,
      fieldId: 'f_accounts',
    });
    expect(await links(draft.id)).toEqual([{ field_id: 'f_accounts', file_id: file.id }]);
    const [event] = (await events(t.tenantA, 'platform.file.uploaded')).filter(
      (e) => e.entity_id === file.id,
    );
    expect(event?.actor_id).toBe(t.ann.membershipId);
    expect(JSON.stringify(event)).not.toContain(name);

    const read = await answer<Application>(t.send(t.ann, 'GET', t.path(draft.id)));
    expect(read.answers).toEqual({ f_accounts: [file.id] });
    expect(read.answersVersion).toBe(draft.answersVersion);
  });

  it('refuses a hidden question, a question that is no file question, and an unknown one, linking nothing', async () => {
    const draft = await aDraft();
    const before = await fileCount();
    for (const fieldId of ['f_quotes', 'f_title', 'f_nothere']) {
      const problem = refused(await attach(t.ann, draft.id, fieldId, 'Quote.pdf', pdf()));
      expect(
        problem.errors?.map(({ field }) => field),
        fieldId,
      ).toEqual([fieldId]);
    }
    expect(await links(draft.id)).toEqual([]);
    expect(await fileCount()).toBe(before);

    // Shown once the answer that opens it is saved.
    await answer(t.save(t.ann, draft, { f_haveweb: true }));
    view(await attach(t.ann, draft.id, 'f_quotes', 'Quote.pdf', pdf()));
  });

  it('refuses an answer to a file question when saving answers, naming the question', async () => {
    const draft = await aDraft();
    const response = await t.save(t.ann, draft, { f_accounts: ['anything'] });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors?.map(({ field }) => field)).toEqual(['f_accounts']);
    expect(await links(draft.id)).toEqual([]);
  });

  it('refuses a second file for a question that takes one, and a wrong type or name', async () => {
    const draft = await aDraft();
    view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const more = refused(await attach(t.ann, draft.id, 'f_accounts', 'More.pdf', pdf()));
    expect(more.errors?.[0]).toMatchObject({ field: 'f_accounts' });
    expect(more.detail).toContain('takes no more files');

    expect(refused(await attach(t.ann, draft.id, 'f_photos', 'Photo.png', pdf())).detail).toContain(
      'cannot be uploaded',
    );
    // A PNG named as a PDF.
    expect(refused(await attach(t.ann, draft.id, 'f_papers', 'Plan.pdf', png())).detail).toContain(
      'does not match',
    );
    expect(await links(draft.id)).toHaveLength(1);
  });

  it('refuses the EICAR test string, linking nothing, and keeps the refused file as infected and audited', async () => {
    const draft = await aDraft();
    // ClamAV matches EICAR only as a whole file or an object, so it goes in as a stream object.
    const infected = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length ${eicar().length} >>\n` +
        `stream\n${eicar()}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    );
    const problem = refused(
      await attach(t.ann, draft.id, 'f_accounts', 'Infected-A.pdf', infected),
    );
    expect(problem.errors?.[0]?.field).toBe('f_accounts');
    expect(problem.detail).toContain('virus');

    expect(await links(draft.id)).toEqual([]);
    const [row] = await t.rows<{ id: string; scan_state: string; storage_key: string | null }>(
      "SELECT id, scan_state, storage_key FROM app.file WHERE name = 'Infected-A.pdf'",
    );
    expect(row).toMatchObject({ scan_state: 'infected', storage_key: null });
    const refusals = await events(t.tenantA, 'platform.file.refused');
    expect(refusals.some((event) => event.entity_id === row?.id)).toBe(true);
  });

  it('refuses a file that would take the application past its total, and links nothing', async () => {
    const draft = await aDraft();
    await asMigratorIn(t.tenantA.id, async (client) => {
      for (let n = 0; n < 10; n++) {
        const id = await insertRow(client, 'app.file', {
          tenant_id: t.tenantA.id,
          name: `Papers ${n}.pdf`,
          content_type: 'application/pdf',
          size_bytes: MAX_FILE_BYTES,
          created_by: t.ann.membershipId,
        });
        await client.query(
          "UPDATE app.file SET scan_state = 'clean', sha256 = $2, storage_key = $3 WHERE id = $1",
          [id, createHash('sha256').update(id).digest(), `clean/${t.tenantA.id}/${id}`],
        );
        await insertRow(client, 'grants.application_file', {
          tenant_id: t.tenantA.id,
          application_id: draft.id,
          file_id: id,
          field_id: 'f_papers',
          created_by: t.ann.membershipId,
        });
      }
    });
    const problem = refused(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    expect(problem.detail).toContain('100 MB');
    expect(problem.errors?.[0]?.field).toBe('f_accounts');
    expect(await links(draft.id)).toHaveLength(10);
  });

  it('lets one of two uploads at once into a question that takes one file', async () => {
    const draft = await aDraft();
    const responses = await Promise.all([
      attach(t.ann, draft.id, 'f_accounts', 'First.pdf', pdf()),
      attach(t.ann, draft.id, 'f_accounts', 'Second.pdf', pdf()),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 400]);
    expect(await links(draft.id)).toHaveLength(1);
  });

  it('is refused once the application is submitted, or its round has closed', async () => {
    const open = await openForm();
    const { id } = await submittedWith(open);
    expect((await attach(t.ann, id, 'f_photos', 'Photo.png', png())).statusCode).toBe(409);
    expect(await links(id)).toHaveLength(1);

    const other = await openForm();
    const draft = await aDraft(other);
    await t.changeRound(other.round.id, "closes_at = now() - interval '1 hour'");
    expect((await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf())).statusCode).toBe(
      409,
    );
    expect(await links(draft.id)).toEqual([]);
  });
});

describe('an applicant reading and removing their files', () => {
  it('lists them oldest first, sends them without an audit event, and removes one from a draft only', async () => {
    const open = await openForm();
    const draft = await aDraft(open);
    const bytes = pdf();
    const first = view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', bytes));
    const second = view(await attach(t.ann, draft.id, 'f_photos', 'Hall.png', png()));
    expect((await listOf(t.ann, draft.id)).attachments).toEqual([first, second]);

    const sent = await t.send(t.ann, 'GET', t.path(draft.id, `/files/${first.id}`));
    expect(sent.statusCode).toBe(200);
    expect(sent.rawPayload.equals(bytes)).toBe(true);
    expect(sent.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition': expect.stringContaining('attachment') as string,
      'x-content-type-options': 'nosniff',
    });
    expect(await downloads(first.id)).toEqual([]);

    expect(
      (await t.send(t.ann, 'DELETE', t.path(draft.id, `/files/${second.id}`))).statusCode,
    ).toBe(204);
    expect((await listOf(t.ann, draft.id)).attachments).toEqual([first]);
    // The link goes; the file row waits for the retention sweep.
    expect(await t.rows('SELECT id FROM app.file WHERE id = $1', [second.id])).toHaveLength(1);
    const again = await t.send(t.ann, 'DELETE', t.path(draft.id, `/files/${second.id}`));
    expect(again.statusCode).toBe(404);
    expect((await t.send(t.ann, 'GET', t.path(draft.id, `/files/${second.id}`))).statusCode).toBe(
      404,
    );

    await answer(t.submit(t.ann, await t.saved(t.ann, draft, complete)));
    expect((await t.send(t.ann, 'DELETE', t.path(draft.id, `/files/${first.id}`))).statusCode).toBe(
      409,
    );
    expect((await listOf(t.ann, draft.id)).attachments).toEqual([first]);
  });

  it('keeps the files of a withdrawn application', async () => {
    const { id, first } = await submittedWith(await openForm());
    await answer(t.send(t.ann, 'POST', t.path(id, '/withdraw')));
    expect((await listOf(t.ann, id)).attachments).toEqual([first]);
    expect((await t.send(t.ann, 'GET', t.path(id, `/files/${first.id}`))).statusCode).toBe(200);
    const staff = await answer<AttachmentList>(
      t.send(t.managerA, 'GET', `/console/submissions/${id}/files`),
    );
    expect(staff.attachments).toEqual([first]);
  });

  it('answers 404 for another applicant, as for a missing application, on every route', async () => {
    const draft = await aDraft();
    const file = view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const missing = randomUUID();
    const routes = (id: string): [Parameters<typeof t.send>[1], string][] => [
      ['GET', t.path(id, '/files')],
      ['GET', t.path(id, `/files/${file.id}`)],
      ['DELETE', t.path(id, `/files/${file.id}`)],
    ];
    for (const stranger of [t.ben]) {
      for (const [index, [method, url]] of routes(draft.id).entries()) {
        const outside = await t.send(stranger, method, url);
        const nothing = await t.send(stranger, method, routes(missing)[index]?.[1] ?? '');
        expectLooksMissing(outside, nothing);
      }
      expectLooksMissing(
        await attach(stranger, draft.id, 'f_accounts', 'Mine.pdf', pdf()),
        await attach(stranger, missing, 'f_accounts', 'Mine.pdf', pdf()),
      );
    }
    expect(await links(draft.id)).toEqual([{ field_id: 'f_accounts', file_id: file.id }]);
  });

  it("answers 404 for another tenant's application and file", async () => {
    const draft = await aDraft();
    const file = view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const openB = await t.openRound(t.managerB, formFields);
    const theirs = await aDraft(openB, t.cat);
    const theirFile = view(await attach(t.cat, theirs.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const missing = randomUUID();

    expectLooksMissing(
      await t.send(t.cat, 'GET', t.path(draft.id, '/files')),
      await t.send(t.cat, 'GET', t.path(missing, '/files')),
    );
    expectLooksMissing(
      await t.send(t.cat, 'GET', t.path(draft.id, `/files/${file.id}`)),
      await t.send(t.cat, 'GET', t.path(missing, `/files/${file.id}`)),
    );
    expectLooksMissing(
      await attach(t.cat, draft.id, 'f_accounts', 'Mine.pdf', pdf()),
      await attach(t.cat, missing, 'f_accounts', 'Mine.pdf', pdf()),
    );
    // Their own application, with a file that is not on it.
    expectLooksMissing(
      await t.send(t.ann, 'GET', t.path(draft.id, `/files/${theirFile.id}`)),
      await t.send(t.ann, 'GET', t.path(draft.id, `/files/${missing}`)),
    );
    expect(
      (await t.send(t.managerB, 'GET', `/console/submissions/${draft.id}/files`)).statusCode,
    ).toBe(404);
  });
});

describe('staff reading a submission', () => {
  it("list the files on questions staff see, and each download is audited, an applicant's is not", async () => {
    const open = await openForm();
    const { id, first, others } = await submittedWith(
      open,
      ['f_photos', 'Hall.png', png()],
      ['f_papers', 'Notes.pdf', pdf()],
    );
    const [photo, notes] = others;
    if (photo === undefined || notes === undefined) throw new Error('The files were not attached.');

    const staff = await answer<AttachmentList>(
      t.send(t.managerA, 'GET', `/console/submissions/${id}/files`),
    );
    expect(staff.attachments).toEqual([first, photo]);

    const sent = await t.send(t.managerA, 'GET', `/console/submissions/${id}/files/${first.id}`);
    expect(sent.statusCode).toBe(200);
    expect(sent.headers['content-type']).toBe('application/pdf');
    const [event] = await downloads(first.id);
    expect(event?.actor_id).toBe(t.managerA.membershipId);

    // The applicant-only question's file is no staff file.
    expect(
      (await t.send(t.managerA, 'GET', `/console/submissions/${id}/files/${notes.id}`)).statusCode,
    ).toBe(404);
    expect(await downloads(notes.id)).toEqual([]);

    await t.send(t.ann, 'GET', t.path(id, `/files/${first.id}`));
    expect(await downloads(first.id)).toHaveLength(1);
  });

  it('get 404 for a draft, a missing submission and another tenant, and 403 without the permission', async () => {
    const draft = await aDraft();
    const file = view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const { id } = await submittedWith(await openForm());
    const missing = randomUUID();

    expectLooksMissing(
      await t.send(t.managerA, 'GET', `/console/submissions/${draft.id}/files`),
      await t.send(t.managerA, 'GET', `/console/submissions/${missing}/files`),
    );
    expectLooksMissing(
      await t.send(t.managerA, 'GET', `/console/submissions/${draft.id}/files/${file.id}`),
      await t.send(t.managerA, 'GET', `/console/submissions/${missing}/files/${file.id}`),
    );
    expect(await downloads(file.id)).toEqual([]);

    const mine = (await listOf(t.ann, id)).attachments[0];
    expect(
      (await t.send(t.managerB, 'GET', `/console/submissions/${id}/files/${mine?.id ?? ''}`))
        .statusCode,
    ).toBe(404);
    expect((await t.send(t.managerB, 'GET', `/console/submissions/${id}/files`)).statusCode).toBe(
      404,
    );

    for (const url of [
      `/console/submissions/${id}/files`,
      `/console/submissions/${id}/files/${mine?.id ?? ''}`,
    ]) {
      expect((await t.send(t.reviewerA, 'GET', url)).statusCode, url).toBe(403);
      expect((await t.send(t.applicantA, 'GET', url, undefined, 'console')).statusCode, url).toBe(
        403,
      );
      expect((await t.send(t.ann, 'GET', url, undefined, 'portal')).statusCode, url).toBe(403);
      expect((await t.send(undefined, 'GET', url)).statusCode, url).toBe(401);
    }
  });
});

describe('submitting with files', () => {
  it('stops at a required file question with no file, names it, and goes through once a file is attached', async () => {
    const draft = await aDraft();
    const ready = await t.saved(t.ann, draft, complete);
    const stopped = await t.submit(t.ann, ready);
    expect(stopped.statusCode).toBe(400);
    expect(stopped.json<Problem>().errors?.map(({ field }) => field)).toEqual(['f_accounts']);

    view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const submitted = await answer<Application>(t.submit(t.ann, ready));
    expect(submitted.status).toBe('submitted');
  });
});

describe('who may use the routes', () => {
  it('refuse staff and a signed-out caller, and answer 404 for every route with grants off', async () => {
    const draft = await aDraft();
    const file = view(await attach(t.ann, draft.id, 'f_accounts', 'Accounts.pdf', pdf()));
    const portal = [t.path(draft.id, '/files'), t.path(draft.id, `/files/${file.id}`)];
    const upload = t.path(draft.id, '/fields/f_accounts/files');
    for (const url of portal) {
      expect((await t.send(t.managerA, 'GET', url, undefined, 'portal')).statusCode, url).toBe(403);
      expect((await t.send(undefined, 'GET', url)).statusCode, url).toBe(401);
    }
    expect(
      (await t.send(t.managerA, 'DELETE', portal[1] ?? '', undefined, 'portal')).statusCode,
    ).toBe(403);
    expect((await t.upload(t.managerA, upload, 'A.pdf', pdf())).statusCode).toBe(403);
    expect((await t.upload(undefined, upload, 'A.pdf', pdf())).statusCode).toBe(401);
    expect(await links(draft.id)).toHaveLength(1);

    const switchTo = (enabled: boolean) =>
      asMigratorIn(t.tenantA.id, (client) =>
        client
          .query(
            `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by)
             VALUES ($1, 'grants', $2, $3)
             ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [t.tenantA.id, enabled, t.managerA.membershipId],
          )
          .then(() => undefined),
      );
    await switchTo(false);
    try {
      for (const url of portal) {
        expect((await t.send(t.ann, 'GET', url)).statusCode, url).toBe(404);
      }
      expect((await t.send(t.ann, 'DELETE', portal[1] ?? '')).statusCode).toBe(404);
      expect((await attach(t.ann, draft.id, 'f_photos', 'A.png', png())).statusCode).toBe(404);
      for (const tail of ['/files', `/files/${file.id}`]) {
        const url = `/console/submissions/${draft.id}${tail}`;
        expect((await t.send(t.managerA, 'GET', url)).statusCode, url).toBe(404);
      }
    } finally {
      await switchTo(true);
    }
  });
});
