// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the rights handlers need from the platform and from party, bound to
// the request by the API as `context.subjectRights` (ADR 0016: privacy never
// imports the platform or party's tables). Every call runs in the request's
// transaction as the session's member, so a rollback undoes it. The platform
// starts and reads the jobs; privacy only asks, for the request's subject.

import type { ErasureStatus, JobRequest } from '@pixel-scientists/domain/platform/subject-access';

import type { ConsentHistory } from '../../contracts/index.ts';
import type { PrivacyContext } from '../context.ts';

export interface SubjectRights {
  /** Starts the platform's export for a person, covering every module, and answers the job request's id. */
  startExport(personId: string): Promise<string>;
  /** Starts the platform's erasure for a person with the reason `subject_request`, and answers the job request's id. A person already erased fails as the platform's 404. */
  startErasure(personId: string): Promise<string>;
  /** The export's status, or null where there is no such export in the tenant. */
  exportStatus(jobRequestId: string): Promise<JobRequest | null>;
  /** The erasure's status, or null where there is no such erasure in the tenant. */
  erasureStatus(jobRequestId: string): Promise<ErasureStatus | null>;
  /** The person's consent history from party's contract, or null where there is no such person in the tenant. */
  consentHistory(personId: string): Promise<ConsentHistory['entries'] | null>;
}

export interface RightsContext extends PrivacyContext {
  readonly subjectRights: SubjectRights;
}
