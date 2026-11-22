// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The closed list of signature adapters (ADR 0040), by provider key. A
// provider's adapter is one file added here; nothing a tenant or a request
// names can add one. The cell's settings choose which key is live, and a
// connection naming any other key gets no adapter.

import type { SignatureProvider } from '@pixel-scientists/domain/documents';

import { FakeEsignProvider } from './fake.ts';

/** Each adapter's factory. The fake is for development and tests only (settings.ts). */
const adapters = {
  fake: () => new FakeEsignProvider(),
} as const satisfies Record<string, () => SignatureProvider>;

export type ProviderKey = keyof typeof adapters;

/** Adapters that sign with a key anyone can read: a cell that is not in development mode refuses them. */
export const developmentOnly: readonly ProviderKey[] = ['fake'];

export const providerKeys = Object.keys(adapters) as readonly ProviderKey[];

/** The live adapter of a connection's provider key, or undefined for any other key. */
export type SignatureProviders = (key: string) => SignatureProvider | undefined;

export function createProviders(live: ProviderKey | null): SignatureProviders {
  const adapter = live === null ? undefined : adapters[live]();
  return (key) => (key === live ? adapter : undefined);
}
