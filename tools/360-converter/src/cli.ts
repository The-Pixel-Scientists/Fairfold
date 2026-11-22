#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 360-converter (README.md): reads the CSV named, writes the 360Giving file
// to standard output or --output, and the summary to standard error. It makes
// no network call and writes nothing else.

import '@pixel-scientists/domain/jitless';

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { suiteName } from '@pixel-scientists/domain/platform';

import { convert, MAX_GRANTS } from './convert.ts';

const DATA_QUALITY_TOOL = 'https://dataquality.threesixtygiving.org/';

const help = `${suiteName} 360Giving converter

Turns a CSV of grants to organisations into a 360Giving JSON file. The CSV
needs the header row from template.csv and one row for each grant, up to
${MAX_GRANTS.toLocaleString('en-GB')}. Nothing is sent anywhere or kept.

Usage:
  360-converter <grants.csv> --funder-name <name> --funder-identifier <id>
    --identifier-prefix <prefix> [--output <file>]

Options:
  --funder-name        The funder's name as it should be published
  --funder-identifier  The funder's identifier from org-id.guide, like GB-CHC-1234567
  --identifier-prefix  The prefix 360Giving gave the funder, like 360G-northfield
  --output             The file to write the JSON to, instead of standard output
  --help               Show this help

Check the file with 360Giving's data quality tool before you publish it:
${DATA_QUALITY_TOOL}
`;

const plural = (count: number, word: string) =>
  `${count.toLocaleString('en-GB')} ${word}${count === 1 ? '' : 's'}`;

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

function run(args: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        'funder-name': { type: 'string', default: '' },
        'funder-identifier': { type: 'string', default: '' },
        'identifier-prefix': { type: 'string', default: '' },
        output: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
  } catch {
    return fail(
      'The command has an option the converter does not know. Run it with --help to see the options.',
    );
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    process.stdout.write(help);
    return 0;
  }
  const [input] = positionals;
  if (input === undefined || positionals.length > 1) {
    return fail('Name one CSV file to convert. Run the converter with --help to see how.');
  }

  let bytes;
  try {
    bytes = readFileSync(input);
  } catch {
    return fail(`Cannot open ${input}. Check the file name and that you can open the file.`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(
      'The file is not UTF-8. Save it from your spreadsheet as "CSV UTF-8", then convert it again.',
    );
  }

  const result = convert(
    text,
    {
      funderName: values['funder-name'],
      funderIdentifier: values['funder-identifier'],
      identifierPrefix: values['identifier-prefix'],
    },
    new Date().toISOString(),
  );
  if (!result.ok) {
    const list = result.problems.map((problem) => `- ${problem}`).join('\n');
    return fail(`No file written. Fix these problems, then convert the file again:\n${list}`);
  }

  const json = `${JSON.stringify(result.file, null, 2)}\n`;
  if (values.output === undefined) {
    process.stdout.write(json);
  } else {
    try {
      writeFileSync(values.output, json);
    } catch {
      // Never leave part of a file behind.
      try {
        rmSync(values.output, { force: true });
      } catch {
        // A folder of that name, or no right to remove it: nothing was written.
      }
      return fail(
        `Cannot write ${values.output}. Check the folder exists and you can save files in it.`,
      );
    }
  }

  const { grants, uncheckedRecipients } = result.summary;
  const written = values.output === undefined ? '' : ` to ${values.output}`;
  const unchecked = `${plural(uncheckedRecipients, 'recipient identifier')} ${uncheckedRecipients === 1 ? 'is' : 'are'}`;
  process.stderr.write(
    `Converted ${plural(grants, 'grant')}${written}. ${unchecked} not checked against a register. ` +
      `Check the file with 360Giving's data quality tool before you publish it: ${DATA_QUALITY_TOOL}\n`,
  );
  return 0;
}

process.exitCode = run(process.argv.slice(2));
