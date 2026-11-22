// SPDX-License-Identifier: AGPL-3.0-or-later

interface Result {
  nonces?: number[];
}

/** Runs the check in a bundled worker, so the page and a screen reader stay responsive. */
export function solveInWorker(challenge: string, difficulty: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./proof.worker.ts', import.meta.url), { type: 'module' });
    const fail = () => {
      worker.terminate();
      reject(new Error('The check could not run.'));
    };
    worker.onmessage = (event: MessageEvent<Result>) => {
      worker.terminate();
      if (event.data.nonces === undefined) fail();
      else resolve(event.data.nonces);
    };
    worker.onerror = fail;
    worker.postMessage({ challenge, difficulty });
  });
}
