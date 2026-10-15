// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's published contracts (ADR 0016): checked lists,
// schemas, routes and audit action codes, safe for the browser.

import '@pixel-scientists/domain/jitless';

export { grantsAuditActions, type GrantsAuditAction } from './audit.ts';
export {
  formVersionListSchema,
  formVersionSchema,
  formVersionSummarySchema,
  type FormVersion,
  type FormVersionList,
  type FormVersionSummary,
} from './forms/answers.ts';
export {
  formConfigEntityType,
  formDiff,
  formPathPattern,
  formVersionDiffSchema,
  MAX_FORM_CHANGES,
  type FormVersionDiff,
} from './forms/config.ts';
export {
  definitionBytes,
  FORM_DEFINITION_MAX_BYTES,
  formDefinitionInputSchema,
  formDraftInputSchema,
  formFileSchema,
  formVersionMessages,
  type FormDraftInput,
  type FormFile,
} from './forms/inputs.ts';
export {
  formVersionStatuses,
  formVersionStatusSchema,
  type FormVersionStatus,
} from './forms/lists.ts';
export {
  createFormDraft,
  discardFormDraft,
  formRoutes,
  getFormVersion,
  listFormVersions,
  publishFormDraft,
  saveFormDraft,
} from './forms/routes.ts';
export {
  criterionSchema,
  emailTemplateSchema,
  emailTemplatesSchema,
  programmeListSchema,
  programmeSchema,
  roundListSchema,
  roundSchema,
  stageListSchema,
  stageSchema,
  type Criterion,
  type EmailTemplates,
  type Programme,
  type ProgrammeList,
  type Round,
  type RoundList,
  type Stage,
  type StageList,
} from './programme/answers.ts';
export {
  configChangeSchema,
  configDiff,
  configDiffSchema,
  configHistorySchema,
  configPathPattern,
  configVersionDiffSchema,
  configVersionSchema,
  grantsConfigEntityTypes,
  type ConfigDiff,
  type ConfigHistory,
  type ConfigObject,
  type ConfigValue,
  type ConfigVersion,
  type ConfigVersionDiff,
  type GrantsConfigEntityType,
} from './programme/config.ts';
export {
  amountSchema,
  localDateTimeSchema,
  MAX_AMOUNT_MINOR,
  MAX_CRITERIA,
  MAX_STAGES,
  programmeInputSchema,
  roundInputSchema,
  rubricInputSchema,
  stagesInputSchema,
  type ProgrammeInput,
  type RoundInput,
  type RubricInput,
  type StagesInput,
} from './programme/inputs.ts';
export {
  defaultStageNames,
  latePolicies,
  latePolicySchema,
  outcomeIds,
  outcomes,
  outcomeSchema,
  programmeStatuses,
  programmeStatusSchema,
  type LatePolicy,
  type Outcome,
  type ProgrammeStatus,
} from './programme/lists.ts';
export { programmeMessages, type ProgrammeMessage } from './programme/messages.ts';
export {
  createProgramme,
  createRound,
  getEmailTemplates,
  getProgramme,
  getProgrammeHistory,
  getRound,
  getRoundHistory,
  listProgrammes,
  listRounds,
  listStages,
  programmeRoutes,
  setEmailTemplates,
  setRubric,
  setStages,
  updateProgramme,
  updateRound,
} from './programme/routes.ts';
export {
  defaultEmailTemplates,
  emailTemplatesInputSchema,
  mergeFields,
  mergeFieldsFor,
  mergeFieldsIn,
  type EmailTemplatesInput,
  type MergeField,
} from './programme/templates.ts';
