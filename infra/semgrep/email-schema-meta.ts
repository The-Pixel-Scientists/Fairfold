// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for email-schema-meta.yaml, checked by `semgrep --test infra/semgrep`.

import { z } from 'zod';

// ok: tps-auth-schemas-meta-claims-no-checks
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).meta({ format: 'email' });

// ruleid: tps-auth-schemas-meta-claims-no-checks
export const otherEmail = z.string().meta({ format: 'email' });

// ruleid: tps-auth-schemas-meta-claims-no-checks
export const closedLookAlike = z.record(z.string(), z.string()).meta({ additionalProperties: false });

// ruleid: tps-auth-schemas-meta-claims-no-checks
export const tokenSchema = z.string().meta({ pattern: '^[A-Za-z0-9_-]{20,128}$' });

// ok: tps-auth-schemas-meta-claims-no-checks
export const passwordSchema = z.string().min(12).meta({ description: 'At least 12 characters' });
