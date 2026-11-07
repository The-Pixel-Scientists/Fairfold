// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The installed outbound rules, in a new process for each case because the
// install changes the globals of the process and locks them. Nothing here
// reaches the network: every request is refused before it connects.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

const API = fileURLToPath(new URL('../..', import.meta.url));
const INSTALL = pathToFileURL(fileURLToPath(new URL('./install.ts', import.meta.url))).href;
const MAIN = pathToFileURL(fileURLToPath(new URL('../main.ts', import.meta.url))).href;

const PROBE = `
  const http = await import('node:http');
  const https = await import('node:https');
  const { Agent, setGlobalDispatcher } = await import('undici');
  await import(process.env.PROBE_LOAD);
  const why = (promise) => promise.then(() => 'succeeded', (e) => e?.cause?.code ?? e?.code ?? String(e));
  const probe = (lib, url) => new Promise((resolve) => lib.get(url, () => resolve('succeeded')).on('error', (e) => resolve(e.code)));
  const out = {};
  out.fetchHttp = await why(fetch('http://example.org/'));
  out.fetchLoopback = await why(fetch('https://127.0.0.1:8443/'));
  out.fetchMetadata = await why(fetch('https://169.254.169.254/latest/meta-data'));
  out.httpGet = await probe(http, 'http://example.org/');
  out.httpsLoopback = await probe(https, 'https://127.0.0.1:8443/');
  setGlobalDispatcher(new Agent());
  out.fetchAfterSet = await why(fetch('https://127.0.0.1:8443/'));
  try { https.globalAgent = new https.Agent(); out.assign = 'assigned'; } catch { out.assign = 'refused'; }
  out.httpsAfterAssign = await probe(https, 'https://127.0.0.1:8443/');
  await import(process.env.PROBE_LOAD + '?again');
  out.fetchTwice = await why(fetch('https://127.0.0.1:8443/'));
  console.log(JSON.stringify(out));
`;

function probe(load: string): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env, PROBE_LOAD: load };
  const clean = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !name.toUpperCase().startsWith('TPS_') && !/proxy/i.test(name),
    ),
  );
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', PROBE], {
    cwd: API,
    env: clean,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const last = result.stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(last) as Record<string, string>;
}

const REFUSED = {
  fetchHttp: 'scheme_refused',
  fetchLoopback: 'address_refused',
  fetchMetadata: 'address_refused',
  httpGet: 'scheme_refused',
  httpsLoopback: 'address_refused',
  fetchAfterSet: 'address_refused',
  assign: 'refused',
  httpsAfterAssign: 'address_refused',
  fetchTwice: 'address_refused',
};

describe('the installed outbound rules', () => {
  it('refuse requests through fetch, node:http and node:https with the real policy', () => {
    expect(probe(INSTALL)).toEqual(REFUSED);
  });

  it('are in place after main.ts has been imported, before buildApp() can run', () => {
    expect(probe(MAIN)).toEqual(REFUSED);
  });

  it('are the first import of main.ts', () => {
    const imports = readFileSync(fileURLToPath(MAIN), 'utf8').match(/^import .*$/gm);

    expect(imports?.[0]).toBe("import './outbound/install.ts';");
  });

  it('survive a later setGlobalDispatcher and a later assignment to a global agent', () => {
    const results = probe(INSTALL);

    expect(results['fetchAfterSet']).toBe('address_refused');
    expect(results['assign']).toBe('refused');
    expect(results['httpsAfterAssign']).toBe('address_refused');
  });
});
