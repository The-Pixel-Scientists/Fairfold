// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for response-schemas.yaml, checked by `semgrep --test infra/semgrep`.

import { z } from 'zod';

export const loose = [
  // ruleid: pixelgrant-no-loose-api-schema
  z.any(),
  // ruleid: pixelgrant-no-loose-api-schema
  z.unknown(),
  // ruleid: pixelgrant-no-loose-api-schema
  z.looseObject({ id: z.uuid() }),
  // ruleid: pixelgrant-no-loose-api-schema
  z.object({ id: z.uuid() }).passthrough(),
  // ruleid: pixelgrant-no-loose-api-schema
  z.object({ id: z.uuid() }).loose(),
  // ruleid: pixelgrant-no-loose-api-schema
  z.record(z.string(), z.unknown()),
];

// ok: pixelgrant-no-loose-api-schema
export const strict = z.strictObject({ id: z.uuid(), status: z.enum(['draft', 'submitted']) });
