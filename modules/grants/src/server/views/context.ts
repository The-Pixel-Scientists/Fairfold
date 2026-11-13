// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the saved view and test send handlers read from the platform (ADR
// 0016). The platform has already checked the session, the permission and the
// scope rule. The acting member comes from the session alone.

import type { Permission } from '@pixel-scientists/domain/platform';

import type { TriageContext, TriageDependencies } from '../triage/context.ts';

export interface ViewDependencies extends Pick<TriageDependencies, 'notFound' | 'refuse'> {
  /** A failure that reads as a refusal of this member, not of the record. */
  readonly forbidden: () => Error;
}

export interface ViewContext extends TriageContext {
  readonly membership: { readonly id: string; readonly permissions: ReadonlySet<Permission> };
}
