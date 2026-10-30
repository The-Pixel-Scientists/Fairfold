// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the steps of the journey share. Each spec file is one step of the demo
// and reads what the steps before it left: the people and their authenticator
// keys, and the ids of what they made. The state is a file in the temporary
// folder, so it outlives a spec's worker; step 1 starts it afresh.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { stateFile } from './env.ts';

/** Someone who signs in: staff with an authenticator key once enrolled, applicants without. */
export interface Person {
  email: string;
  password: string;
  /** The authenticator app's key. */
  key?: string;
  /** The last 30-second step whose code was used: each code works once. */
  lastStep?: number;
}

export interface State {
  people: Record<string, Person>;
  /** Ids of what the steps made, by name: programmeId, roundId, and so on. */
  ids: Record<string, string>;
  /** Lists of ids, by name: applicationIds, assignmentIds, and so on. */
  lists: Record<string, string[]>;
}

const empty = (): State => ({ people: {}, ids: {}, lists: {} });

export function readState(): State {
  try {
    return { ...empty(), ...(JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<State>) };
  } catch {
    return empty();
  }
}

/** Forgets the state and every session kept beside it. */
export function resetState(): void {
  const folder = dirname(stateFile);
  mkdirSync(folder, { recursive: true });
  for (const file of readdirSync(folder)) {
    if (file.startsWith(basename(stateFile))) rmSync(join(folder, file), { force: true });
  }
}

/** Changes the state and writes it before returning. */
export function updateState(change: (state: State) => void): State {
  const state = readState();
  change(state);
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  return state;
}

/** An id an earlier step made, or a failure that says which step to run first. */
export function need(name: string): string {
  const id = readState().ids[name];
  if (id === undefined) {
    throw new Error(
      `The state has no ${name}. Run the steps in order with one worker: pnpm test:stack --project journey --workers 1.`,
    );
  }
  return id;
}

export function needList(name: string): string[] {
  const list = readState().lists[name];
  if (list === undefined || list.length === 0) {
    throw new Error(`The state has no ${name}. Run the steps in order with one worker.`);
  }
  return list;
}

export function person(name: string): Person {
  const found = readState().people[name];
  if (found === undefined) throw new Error(`The state has no ${name}. Run the steps in order.`);
  return found;
}
