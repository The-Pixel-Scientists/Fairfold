// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for response-schemas.yaml, checked by `semgrep --test infra/semgrep`.

// ok: tps-contracts-import-z-only
import { z } from 'zod';
// ok: tps-contracts-import-z-only
import type { ZodType } from 'zod';
// ruleid: tps-contracts-import-z-only
import * as zod from 'zod';
// ruleid: tps-contracts-import-z-only
import { z as schema } from 'zod';
// ruleid: tps-contracts-import-z-only
import { object, unknown } from 'zod';
// ruleid: tps-contracts-import-z-only
import { z as mini } from 'zod/mini';
// ruleid: tps-contracts-import-z-only
export { looseObject } from 'zod';

export const loose = [
  // ruleid: tps-no-loose-api-schema
  z.any(),
  // ruleid: tps-no-loose-api-schema
  z.unknown(),
  // ruleid: tps-no-loose-api-schema
  z.json(),
  // ruleid: tps-no-loose-api-schema
  z.custom<`GB-${string}`>((value) => typeof value === 'string' && value.startsWith('GB-')),
  // ruleid: tps-no-loose-api-schema
  z.looseObject({ id: z.uuid() }),
  // ruleid: tps-no-loose-api-schema
  z.object({ id: z.uuid() }).passthrough(),
  // ruleid: tps-no-loose-api-schema
  z.object({ id: z.uuid() }).loose(),
  // ruleid: tps-no-loose-api-schema
  z.object({ id: z.uuid() }).catchall(z.string()),
  // ruleid: tps-no-loose-api-schema
  z.record(z.string(), z.unknown()),
];

// ok: tps-no-loose-api-schema
export const strict = z.strictObject({ id: z.uuid(), status: z.enum(['draft', 'submitted']) });

// ok: tps-no-loose-api-schema
export const settings = z.strictObject({ preset: z.enum(['calm', 'bold']), notes: z.string() });

// ok: tps-no-loose-api-schema
export const charityNumber = z.string().refine((value) => value.startsWith('GB-'));

export type { ZodType };
export { zod, schema, object, unknown, mini };
