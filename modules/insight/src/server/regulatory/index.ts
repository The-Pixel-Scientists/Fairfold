// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The regulatory reports' server entry (S12-60): the publication run routes
// and the preparation job's work. Nothing in this folder makes a request out
// of the process: the file is stored, reviewed, and submitted by a member.

export { runHandlers as regulatoryHandlers, type Requester, type RunDependencies } from './runs.ts';
export {
  preparePublication,
  type PrepareJob,
  type PrepareOutcome,
  type PreparationDependencies,
} from './job.ts';
export type { Output as PublicationOutput } from './builders.ts';
export type {
  CommittedFigures,
  Period,
  PublicationSources,
  ThreeSixtyGivingBuild,
} from './sources.ts';
