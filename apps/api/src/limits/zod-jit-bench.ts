// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Measures request validation with and without zod's JIT (S11-36), against
// the API's 500 ms p95 target. Not part of the tests or the build:
//
//   node apps/api/src/limits/zod-jit-bench.ts
//
// The JIT is decided when a schema is built, so each mode runs in a process of
// its own, with the switch settled before the schemas load. The large body is a
// saved set of answers close to the API's 64 KiB body limit; the small one is
// the body that starts an application.

import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const RUNS = 300;
const WARM_UP = 30;

const mode = process.argv[2];

function body() {
  const answers: Record<string, unknown> = {};
  for (let i = 0; i < 12; i++) answers[`f_text${String(i)}`] = 'a'.repeat(3000);
  for (let i = 0; i < 6; i++) {
    answers[`f_table${String(i)}`] = Array.from({ length: 15 }, (_, row) => ({
      c_name: `Row ${String(row)} of a table of costs`,
      c_units: row,
      c_note: 'b'.repeat(60),
    }));
  }
  for (let i = 0; i < 30; i++) answers[`f_number${String(i)}`] = i;
  for (let i = 0; i < 10; i++) answers[`f_choice${String(i)}`] = ['one', 'two', 'three'];
  return { basedOn: 3, answers };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

async function measure(): Promise<void> {
  // Every contracts entry point switches the JIT off as it loads. For the
  // JIT run, the switch is made to do nothing, before the contracts load.
  if (mode === 'with-jit') {
    Object.defineProperty(z.core.globalConfig, 'jitless', { get: () => false, set: () => {} });
  }
  const { saveAnswersInputSchema, startApplicationInputSchema } =
    await import('@pixel-scientists/grants/contracts');
  const cases = [
    ['large (saved answers)', saveAnswersInputSchema, body()],
    [
      'small (start an application)',
      startApplicationInputSchema,
      { organisationId: '0192f1c0-0000-7000-8000-000000000001' },
    ],
  ] as const;
  const result: Record<string, { bytes: number; medianMs: number; p95Ms: number }> = {};
  for (const [name, schema, input] of cases) {
    const times: number[] = [];
    for (let i = 0; i < RUNS + WARM_UP; i++) {
      const start = performance.now();
      const parsed = schema.safeParse(input);
      const took = performance.now() - start;
      if (!parsed.success) throw new Error(`The ${name} body did not validate.`);
      if (i >= WARM_UP) times.push(took);
    }
    times.sort((a, b) => a - b);
    result[name] = {
      bytes: JSON.stringify(input).length,
      medianMs: Number(percentile(times, 0.5).toFixed(3)),
      p95Ms: Number(percentile(times, 0.95).toFixed(3)),
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (mode === 'with-jit' || mode === 'without-jit') {
  await measure();
} else {
  const self = fileURLToPath(import.meta.url);
  for (const each of ['with-jit', 'without-jit']) {
    const run = spawnSync(process.execPath, [self, each], { encoding: 'utf8' });
    process.stdout.write(`${each}: ${run.status === 0 ? run.stdout : run.stderr}`);
  }
}
