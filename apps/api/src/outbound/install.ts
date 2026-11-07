// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Installs the outbound rules (ADR 0010) as a side effect of being imported,
// and exports nothing. It is the first import of every process that makes
// outbound requests, the API's `main.ts` and the worker's entry point, so it
// runs before Fastify, Better Auth, jose or any other module loads.
//
// Three things change: undici's global dispatcher, which carries every
// `fetch`; and the global agents of `node:http` and `node:https`. Each is then
// locked, so a later `setGlobalDispatcher` or `http.globalAgent = ...` cannot
// replace it. The process refuses to run with a proxy variable set.

import { writeSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import { setGlobalDispatcher } from 'undici';

import { OutboundHttpAgent, OutboundHttpsAgent } from './agents.ts';
import { createOutboundDispatcher } from './dispatcher.ts';
import { proxyProblems } from './proxy.ts';

const INSTALLED = Symbol.for('tps.outbound.installed');
/** undici's global dispatcher slots: the current one and the legacy one Node.js's own fetch reads. */
const DISPATCHER_SLOTS = [
  Symbol.for('undici.globalDispatcher.2'),
  Symbol.for('undici.globalDispatcher.1'),
];

function lock(target: object, name: PropertyKey, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: false, configurable: false });
}

/** A getter with no setter, so assigning to `globalAgent` throws in a module. */
function pinAgent(module: typeof http | typeof https, agent: http.Agent): void {
  // Node.js keeps the agent that `http.request` uses behind the setter, so set it first.
  module.globalAgent = agent;
  Object.defineProperty(module, 'globalAgent', { get: () => agent, configurable: false });
}

function install(): void {
  const problems = proxyProblems(process.env);
  if (problems.length > 0) {
    // Synchronous, because the process exits before a pipe would flush.
    writeSync(
      2,
      problems
        .map(
          (problem) => `${problem}
`,
        )
        .join(''),
    );
    process.exit(1);
  }
  const target = globalThis as Record<PropertyKey, unknown>;
  if (target[INSTALLED] === true) return;

  setGlobalDispatcher(createOutboundDispatcher());
  for (const slot of DISPATCHER_SLOTS) lock(globalThis, slot, target[slot]);
  pinAgent(http, new OutboundHttpAgent());
  pinAgent(https, new OutboundHttpsAgent());
  lock(globalThis, INSTALLED, true);
}

install();
