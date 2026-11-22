// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The sanctions list download job (ADR 0009, ADR 0031). apps/api defines the
// platform queue `assure.sanctions_list_refresh`, which runs once a day, and
// passes in the client pinned to the list's host. The job downloads the file,
// and when its hash is the live version's only records that it was checked.
// Otherwise it reads the file strictly, checks it as a whole, and has the
// approved loader function store it as a new version in one transaction. A
// refused or failed download writes nothing and leaves the live version, so
// the run that follows sees a list that goes stale, never one that is wrong.
// The file, its text and every entry's name stay out of errors and logs.

import { downloadList, type Fetcher } from './download.ts';
import { checkList } from './list.ts';
import { currentList, loadReferenceList, type Tx } from './store.ts';

/** The codes a failed job ends with: the worker's closed list, never a message. */
export type IngestFailureCode = 'invalid_payload' | 'precondition_failed' | 'internal';

export interface IngestJob {
  readonly id: string;
  readonly data: unknown;
}

export interface IngestDependencies {
  /** The configured address; with none, this deployment has no list and the job does nothing. */
  readonly url: URL | undefined;
  /** The client pinned to the list's host. */
  readonly fetcher: Fetcher;
  readonly fail: (code: IngestFailureCode) => Error;
  /** The fewest designations a whole list has; the module's own floor when left out. */
  readonly minimum?: number;
}

export function sanctionsListRefresh(deps: IngestDependencies) {
  return async (tx: Tx, job: IngestJob): Promise<void> => {
    const keys =
      typeof job.data === 'object' && job.data !== null ? Object.keys(job.data) : ['invalid'];
    if (keys.some((key) => key !== 'slot')) throw deps.fail('invalid_payload');
    if (deps.url === undefined) return;

    const downloaded = await downloadList(deps.fetcher, deps.url);
    if (!downloaded.ok) {
      throw deps.fail(
        downloaded.failure === 'list_unavailable' ? 'internal' : 'precondition_failed',
      );
    }
    const current = await currentList(tx);
    if (current?.sha256.equals(downloaded.sha256) === true) {
      await loadReferenceList(tx, { publishedOn: null, sha256: downloaded.sha256, rows: [] });
      return;
    }
    const checked = checkList(downloaded.body, current?.rowCount ?? null, deps.minimum);
    if (!checked.ok) throw deps.fail('precondition_failed');
    await loadReferenceList(tx, {
      publishedOn: checked.publishedOn,
      sha256: downloaded.sha256,
      rows: checked.rows,
    });
  };
}
