// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What insight's code may not touch (ADR 0016, ADR 0032): grants' tables and
// types, and anything that would carry a raw count out of a request.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const insight = join(import.meta.dirname, '..', '..');
const source = join(insight, 'src');

function sources(folder: string): { file: string; text: string }[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => ({ file, text: readFileSync(file, 'utf8') }));
}

describe('insight’s code', () => {
  it('never names grants’ generated types, its monitoring table or its server', () => {
    const found = sources(source).filter(({ text }) =>
      /generated\/grants|grants\.monitoring_response|@pixel-scientists\/grants\/server/.test(text),
    );

    expect(found.map(({ file }) => file)).toEqual([]);
  });

  it('keeps no log line, span, metric or cache where the counts pass', () => {
    const server = sources(import.meta.dirname);
    expect(server.length).toBeGreaterThan(0);

    const found = server.filter(({ text }) =>
      /console\.|logger|telemetry|opentelemetry|span|metric|cache/i.test(text),
    );

    expect(found.map(({ file }) => file)).toEqual([]);
  });
});
