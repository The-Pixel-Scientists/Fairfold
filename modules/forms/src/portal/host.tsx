// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the app that shows these pages gives them: how to call the API, whose
// pages these are, and where unsaved answers are kept. The pages import no
// app code (ADR 0016), so the portal and the embed each pass in their own.

import type { CallInput, CallResult, JsonRouteContract } from '@pixel-scientists/domain/api';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export interface FormsCallOptions {
  /** To try a submission again: the key of the one that failed. */
  idempotencyKey?: string;
  /** Sends no cookie, for pages anyone can open. */
  anonymous?: boolean;
}

export type FormsCall = <const C extends JsonRouteContract>(
  route: C,
  input: CallInput<C>,
  options?: FormsCallOptions,
) => Promise<CallResult<C>>;

export interface KeptDraft<T> {
  values: T;
  change: (values: T) => void;
  /** True when the page opened with what the person had typed before. */
  restored: boolean;
  /** Call once the values are saved. */
  discard: () => void;
}

export interface FormsHost {
  call: FormsCall;
  /** The funder's slug, from the address. */
  slug: string;
  /** True when the page is in a frame on another website. */
  embedded: boolean;
  /** Keeps what a signed-in person has typed and not yet saved, so a session that ends does not lose it. */
  useDraft: <T>(form: string, saved: T) => KeptDraft<T>;
}

/** Keeps the values for as long as the page is open. For a host with no longer-lived place to keep them. */
export function useMemoryDraft<T>(_form: string, saved: T): KeptDraft<T> {
  const [values, setValues] = useState<T>(saved);
  return { values, change: setValues, restored: false, discard: () => undefined };
}

const HostContext = createContext<FormsHost | null>(null);

export function FormsHostProvider({ host, children }: { host: FormsHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useFormsHost(): FormsHost {
  const host = useContext(HostContext);
  if (host === null) throw new Error('useFormsHost must be used inside a FormsHostProvider.');
  return host;
}
