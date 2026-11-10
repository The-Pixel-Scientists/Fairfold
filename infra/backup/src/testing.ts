// SPDX-License-Identifier: AGPL-3.0-or-later
//
// node:test's describe and it return promises the runner tracks itself. These
// wrappers say so once, instead of on every line of every test file.

import { describe as nodeDescribe, it as nodeIt } from 'node:test';

export function describe(name: string, body: () => void): void {
  void nodeDescribe(name, body);
}

export function it(name: string, body: () => void | Promise<void>): void {
  void nodeIt(name, body);
}
