// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The impact module's published contracts (ADR 0016): outcomes frameworks
// with their indicators, targets, results with evidence, learning notes, a
// framework's progress, and audit action codes, safe for the browser.

import '@pixel-scientists/domain/jitless';

export { impactAuditActions, type ImpactAuditAction } from './audit.ts';
export { MAX_FIGURE, figureProblem, figureSchema } from './figures.ts';
export {
  MAX_INDICATORS,
  MAX_OUTCOMES,
  frameworkDiff,
  frameworkInputSchema,
  frameworkListSchema,
  frameworkSchema,
  indicatorAggregations,
  indicatorDirections,
  indicatorUnits,
  type Framework,
  type FrameworkChange,
  type FrameworkInput,
  type FrameworkList,
  type IndicatorAggregation,
  type IndicatorDirection,
  type IndicatorUnit,
} from './frameworks.ts';
export { impactMessages, impactRefusals, type ImpactMessage } from './messages.ts';
export {
  learningNoteInputSchema,
  learningNoteListSchema,
  learningNoteSchema,
  type LearningNote,
  type LearningNoteInput,
  type LearningNoteList,
} from './notes.ts';
export {
  MAX_EVIDENCE,
  resultInputSchema,
  resultPageSchema,
  resultQuerySchema,
  resultSchema,
  resultSources,
  resultUpdateSchema,
  type Result,
  type ResultInput,
  type ResultPage,
  type ResultQuery,
  type ResultSource,
  type ResultUpdate,
} from './results.ts';
export {
  archiveFramework,
  createFramework,
  createLearningNote,
  createResult,
  createTarget,
  getFramework,
  getFrameworkSummary,
  getResult,
  impactRoutes,
  listFrameworks,
  listLearningNotes,
  listResults,
  listTargets,
  removeLearningNote,
  removeResult,
  removeTarget,
  updateFramework,
  updateResult,
  updateTarget,
} from './routes.ts';
export {
  frameworkSummarySchema,
  indicatorSummarySchema,
  summaryQuerySchema,
  type FrameworkSummary,
  type IndicatorSummary,
  type SummaryQuery,
} from './summary.ts';
export {
  targetInputSchema,
  targetListSchema,
  targetSchema,
  targetUpdateSchema,
  type Target,
  type TargetInput,
  type TargetList,
  type TargetUpdate,
} from './targets.ts';
