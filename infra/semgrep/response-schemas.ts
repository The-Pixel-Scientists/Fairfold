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

declare const metadata: { description: string };
declare const additionalProperties: boolean;
declare const key: string;

// ruleid: tps-contracts-meta-claims-no-checks
export const uuidLookAlike = z.string().meta({ format: 'uuid' });

// ruleid: tps-contracts-meta-claims-no-checks
export const patterned = z.string().meta({ description: 'A code', pattern: '^[A-Z]+$' });

// ruleid: tps-contracts-meta-claims-no-checks
export const typed = z.string().meta({ type: 'integer' });

// ruleid: tps-contracts-meta-claims-no-checks
export const quoted = z.string().meta({ 'id': 'Named' });

// ruleid: tps-contracts-meta-claims-no-checks
export const closedLookAlike = z.record(z.string(), z.string()).meta({ additionalProperties: false });

// ruleid: tps-contracts-meta-claims-no-checks
export const keyedLookAlike = z.record(z.string(), z.string()).meta({ propertyNames: { enum: ['a'] } });

// ruleid: tps-contracts-meta-claims-no-checks
export const enumLookAlike = z.string().meta({ enum: ['draft', 'submitted'] });

// ruleid: tps-contracts-meta-claims-no-checks
export const constLookAlike = z.string().meta({ const: 'draft' });

// ruleid: tps-contracts-meta-claims-no-checks
export const unionLookAlike = z.string().meta({ anyOf: [{ type: 'string' }] });

// ruleid: tps-contracts-meta-claims-no-checks
export const referenced = z.string().meta({ $ref: '#/$defs/Strict' });

// ruleid: tps-contracts-meta-claims-no-checks
export const quotedRef = z.string().meta({ '$ref': '#/$defs/Strict' });

// ruleid: tps-contracts-meta-claims-no-checks
export const shorthand = z.record(z.string(), z.string()).meta({ additionalProperties });

// ruleid: tps-contracts-meta-claims-no-checks
export const computed = z.string().meta({ [key]: false });

// ruleid: tps-contracts-meta-claims-no-checks
export const lookAlikeKey = z.string().meta({ 'descriptions': 'A note' });

// ruleid: tps-contracts-meta-claims-no-checks
export const spread = z.string().meta({ ...metadata });

// ruleid: tps-contracts-meta-claims-no-checks
export const fromVariable = z.string().meta(metadata);

// ruleid: tps-contracts-meta-claims-no-checks
export const registered = z.string().register(z.globalRegistry, { format: 'date' });

// ruleid: tps-contracts-meta-claims-no-checks
export const registeredSpread = z.string().register(z.globalRegistry, { ...metadata });

// ruleid: tps-contracts-meta-claims-no-checks
export const registeredVariable = z.string().register(z.globalRegistry, metadata);

// ruleid: tps-contracts-meta-claims-no-checks
z.globalRegistry.add(described, { description: 'Added outside the schema' });

// ruleid: tps-contracts-meta-claims-no-checks
export const otherEmail = z.string().meta({ format: 'email' });

// ok: tps-contracts-meta-claims-no-checks
export const described = z.string().meta({ description: 'The programme name' });

// ok: tps-contracts-meta-claims-no-checks
export const documented = z.string().meta({ title: 'Name', 'description': 'The programme name', examples: ['Arts'], deprecated: true });

// ok: tps-contracts-meta-claims-no-checks
export const registeredDescription = z.string().register(z.globalRegistry, { description: 'A note' });

// ruleid: tps-contracts-meta-claims-no-checks
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).meta({ format: 'email' });
