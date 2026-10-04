// SPDX-License-Identifier: AGPL-3.0-or-later
//
// zod builds fast object parsers with `new Function`, and probes for it when a
// schema is created. The browser apps' Content Security Policy forbids eval
// and reports the probe even though zod catches the error, so the contracts
// run zod without it. Every contracts entry point imports this first (from a
// module, as `@pixel-scientists/domain/jitless`): ES modules run a module's first
// import before the rest, so the setting is in place before any schema is
// built, however a bundle is split.

import { z } from 'zod';

z.config({ jitless: true });
