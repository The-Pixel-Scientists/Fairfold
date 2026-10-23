// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Authenticator codes for the journey's staff. The API takes the code of the
// current 30-second step or the one either side, and each step only once. So
// the next code is the earliest of this step and the next that is later than
// the last one used, which gives two codes in every 30 seconds without a
// fixed wait; only a third in the same half minute waits for the clock.

import { totp } from '../../apps/console/e2e/auth-totp.ts';
import { expect } from '../../scripts/e2e/fixtures.ts';
import { person, updateState } from './state.ts';

const STEP_MS = 30_000;

const stepAt = (ms: number): number => Math.floor(ms / STEP_MS);

/** The earliest step that may still be used, or undefined until the clock moves on. */
function usableStep(lastStep: number | undefined): number | undefined {
  const now = stepAt(Date.now());
  return [now, now + 1].find((step) => lastStep === undefined || step > lastStep);
}

/** The code `name` types next, from the key set up for them. It marks the step as used. */
export async function nextCode(name: string): Promise<string> {
  const { key, lastStep } = person(name);
  if (key === undefined) throw new Error(`${name} has no authenticator key yet.`);
  await expect
    .poll(() => usableStep(lastStep) !== undefined, {
      message: `No unused code for ${name} until the next step.`,
      timeout: 45_000,
    })
    .toBe(true);
  const step = usableStep(lastStep) ?? 0;
  updateState((state) => {
    const found = state.people[name];
    if (found !== undefined) found.lastStep = step;
  });
  return totp(key, step * STEP_MS);
}

/** Remembers a key that was shown on screen or set up elsewhere. */
export function rememberKey(name: string, key: string, lastStep?: number): void {
  updateState((state) => {
    const found = state.people[name];
    if (found === undefined) throw new Error(`${name} is not in the state.`);
    found.key = key;
    if (lastStep !== undefined) found.lastStep = lastStep;
  });
}
