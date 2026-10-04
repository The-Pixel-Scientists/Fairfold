// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared domain contracts for the API, console and portal. Everything here
// runs unchanged in the browser and on the server, so it may not use DOM or
// Node.js APIs.

import './jitless/index.ts';

export { idSchema, type Id } from './id.ts';
