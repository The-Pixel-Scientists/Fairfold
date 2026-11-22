// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the two export actions send and read, and the words for each. The job
// request's id is held here, in memory, for this browser session only: never
// in the address, the title, web storage or a message, because ids in those
// reach logs, history and referrers.

import { call } from '@pixel-scientists/domain/api';

import {
  readBoardPack,
  readCsvExport,
  requestBoardPack,
  requestCsvExport,
} from '../../contracts/index.ts';

export type ExportKind = 'csv' | 'pack';

export interface ExportWords {
  started: string;
  ready: string;
  link: string;
  /** What it is, in the middle of a sentence. */
  noun: string;
}

export const words: Record<ExportKind, ExportWords> = {
  csv: {
    started: 'Your CSV export has started',
    ready: 'Your CSV export is ready',
    link: 'Download CSV export',
    noun: 'CSV export',
  },
  pack: {
    started: 'Your board pack is being created',
    ready: 'Your board pack is ready',
    link: 'Download board pack',
    noun: 'board pack',
  },
};

/** What a failed job says, by the worker's failure code, and what to do next. */
const failures: Record<string, string> = {
  requester_cannot_read:
    'You no longer have access to what this includes. Ask an administrator at your funder to check your roles.',
  not_found: 'Something it included has been removed. Choose again and start a new one.',
  precondition_failed: 'The saved view or an application has changed. Start a new one.',
};

export const failureText = (code: string): string =>
  failures[code] ?? 'It could not be made. Start a new one.';

const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'long' });

/** `2026-12-24T10:00:00.000Z` as "24 December 2026", in UK time. */
export const formatDay = (iso: string): string => day.format(new Date(iso));

export const startJob = {
  csv: (viewId: string, idempotencyKey: string) =>
    call(requestCsvExport, { body: { viewId } }, { idempotencyKey }),
  pack: (applicationIds: readonly string[], idempotencyKey: string) =>
    call(requestBoardPack, { body: { applicationIds: [...applicationIds] } }, { idempotencyKey }),
};

export const readJob = {
  csv: (requestId: string) => call(readCsvExport, { params: { requestId } }),
  pack: (requestId: string) => call(readBoardPack, { params: { requestId } }),
};

export type JobRequest = Awaited<ReturnType<typeof readJob.csv>>;

const held = new Map<string, string>();

const slot = (userId: string, kind: ExportKind) => `${userId}:${kind}`;

/** The latest job this person started in this session, or undefined. */
export const heldJob = (userId: string, kind: ExportKind) => held.get(slot(userId, kind));

export const holdJob = (userId: string, kind: ExportKind, requestId: string) => {
  held.set(slot(userId, kind), requestId);
};

export const dropJob = (userId: string, kind: ExportKind) => {
  held.delete(slot(userId, kind));
};

export const isFinished = ({ status }: JobRequest) => status !== 'queued' && status !== 'running';

const FIRST_MS = 3000;
const LONGEST_MS = 15000;

/** Waits a little longer after each read, so a slow job is not asked about every few seconds. */
export const nextDelay = (previous: number | null): number =>
  previous === null ? FIRST_MS : Math.min(Math.round(previous * 1.5), LONGEST_MS);
