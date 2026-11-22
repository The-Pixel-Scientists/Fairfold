// SPDX-License-Identifier: AGPL-3.0-or-later

/** A problem the operator can fix, with the exit code to end on: 2 for usage, 1 otherwise. */
export class CliError extends Error {
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}
