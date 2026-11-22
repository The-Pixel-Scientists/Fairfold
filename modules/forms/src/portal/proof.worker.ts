// SPDX-License-Identifier: AGPL-3.0-or-later

import { findNonces } from './solve.ts';

interface Work {
  challenge: string;
  difficulty: number;
}

addEventListener('message', (event: MessageEvent<Work>) => {
  const { challenge, difficulty } = event.data;
  findNonces(challenge, difficulty).then(
    (nonces) => {
      postMessage({ nonces });
    },
    () => {
      postMessage({});
    },
  );
});
