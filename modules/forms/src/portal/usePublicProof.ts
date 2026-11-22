// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browser check for one public form (ADR 0036). It starts when the page
// opens and finishes while the person answers, so most people never wait. A
// proof is used up by the first request that carries it, so the page asks
// for a new one after any answer but success.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getProofChallenge } from '../contracts/index.ts';
import type { Proof } from '../contracts/index.ts';
import type { FormsCall } from './host.tsx';
import { solveInWorker } from './proof.ts';

/** After this long without a finished check, a form that allows it is sent without one. */
export const FALLBACK_AFTER_MS = 30_000;
/** A challenge this close to its end is replaced before it is sent. */
const EXPIRY_MARGIN_MS = 30_000;

interface Check {
  proof: Promise<Proof>;
  expiresAt: number;
}

export type CheckState = 'working' | 'ready' | 'failed';

export interface PublicProof {
  state: CheckState;
  /** The finished proof, waiting for it if need be. Null when the fallback is open and the check is too slow or cannot run. */
  take: (fallbackOpen: boolean) => Promise<Proof | null>;
  /** Starts a new check. */
  renew: () => void;
}

export function usePublicProof(call: FormsCall, slug: string, formId: string): PublicProof {
  const [state, setState] = useState<CheckState>('working');
  const current = useRef<Check | null>(null);

  const start = useCallback((): Check => {
    setState('working');
    const check: Check = { proof: Promise.resolve({ challenge: '', nonces: [] }), expiresAt: 0 };
    check.proof = (async () => {
      const issued = await call(
        getProofChallenge,
        { params: { slug, formId } },
        { anonymous: true },
      );
      check.expiresAt = Date.parse(issued.expiresAt);
      return {
        challenge: issued.challenge,
        nonces: await solveInWorker(issued.challenge, issued.difficulty),
      };
    })();
    current.current = check;
    check.proof.then(
      () => {
        if (current.current === check) setState('ready');
      },
      () => {
        if (current.current === check) setState('failed');
      },
    );
    return check;
  }, [call, slug, formId]);

  useEffect(() => {
    current.current ??= start();
  }, [start]);

  const take = useCallback(
    async (fallbackOpen: boolean): Promise<Proof | null> => {
      let check = current.current ?? start();
      if (check.expiresAt > 0 && Date.now() > check.expiresAt - EXPIRY_MARGIN_MS) check = start();
      if (!fallbackOpen) return check.proof;
      const slow = new Promise<null>((resolve) => {
        setTimeout(() => {
          resolve(null);
        }, FALLBACK_AFTER_MS);
      });
      return Promise.race([check.proof.catch(() => null), slow]);
    },
    [start],
  );

  const renew = useCallback(() => {
    start();
  }, [start]);

  return { state, take, renew };
}
