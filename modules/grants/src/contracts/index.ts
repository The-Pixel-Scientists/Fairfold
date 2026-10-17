// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's published contracts (ADR 0016): checked lists,
// schemas, routes and audit action codes, safe for the browser.

import '@pixel-scientists/domain/jitless';

export {
  answersSavedSchema,
  applicationListSchema,
  applicationSchema,
  applicationSummarySchema,
  eligibilitySchema,
  openRoundDetailSchema,
  openRoundListSchema,
  openRoundSchema,
  type AnswersSaved,
  type Application,
  type ApplicationList,
  type ApplicationSummary,
  type Eligibility,
  type OpenRound,
  type OpenRoundDetail,
  type OpenRoundList,
} from './applications/answers.ts';
export {
  saveAnswersInputSchema,
  startApplicationInputSchema,
  submitApplicationInputSchema,
  type SaveAnswersInput,
  type StartApplicationInput,
  type SubmitApplicationInput,
} from './applications/inputs.ts';
export {
  applicationStatuses,
  applicationStatusSchema,
  eligibilityOutcomes,
  eligibilityOutcomeSchema,
  submissionStatuses,
  submissionStatusSchema,
  type ApplicationStatus,
  type EligibilityOutcome,
  type SubmissionStatus,
} from './applications/lists.ts';
export {
  applicationRoutes,
  checkApplicationEligibility,
  getApplication,
  getOpenRound,
  listApplications,
  listOpenRounds,
  saveApplicationAnswers,
  startApplication,
  submitApplication,
  withdrawApplication,
} from './applications/routes.ts';
export {
  applicantOutcome,
  applicantOutcomeSchema,
  applicantStatus,
  applicantStatuses,
  applicantStatusSchema,
  type ApplicantDecision,
  type ApplicantOutcome,
  type ApplicantStatus,
  type ApplicantStatusInput,
} from './applications/status.ts';
export {
  assignedSchema,
  assignmentListSchema,
  assignmentSchema,
  poolReviewerSchema,
  reviewerCandidatesSchema,
  reviewerPoolSchema,
  reviewerRefSchema,
  type Assigned,
  type Assignment,
  type AssignmentList,
  type ReviewerCandidates,
  type ReviewerPool,
  type ReviewerRef,
} from './assessment/answers.ts';
export {
  assignReviewersAutomatically,
  automaticAssignInputSchema,
  automaticAssignResultSchema,
  type AutomaticAssignInput,
  type AutomaticAssignResult,
} from './assessment/automatic.ts';
export {
  assignInputSchema,
  MAX_ASSIGN_SUBMISSIONS,
  MAX_POOL_ADD,
  MAX_REVIEWERS_PER_SUBMISSION,
  poolAddInputSchema,
  type AssignInput,
  type PoolAddInput,
} from './assessment/inputs.ts';
export {
  assignmentStatuses,
  assignmentStatusSchema,
  reviewStatusSchema,
  type AssignmentStatus,
  type ReviewStatus,
} from './assessment/lists.ts';
export {
  declareConflict,
  getReview,
  listReviews,
  reviewListSchema,
  reviewRoutes,
  reviewSchema,
  reviewScoresSchema,
  reviewSummarySchema,
  saveReviewScores,
  submitReview,
  type Review,
  type ReviewList,
  type ReviewScores,
  type ReviewSummary,
} from './assessment/reviews.ts';
export {
  addReviewers,
  assessmentRoutes,
  assignReviewers,
  getReviewerPool,
  listAssignments,
  listReviewerCandidates,
  removeAssignment,
  removeReviewer,
} from './assessment/routes.ts';
export {
  scoreSchema,
  scoresInputSchema,
  type Score,
  type ScoresInput,
} from './assessment/scores.ts';
export {
  getScoreSpread,
  getSubmissionScores,
  scoreSpreadSchema,
  spreadRoutes,
  spreadRowSchema,
  submissionScoresSchema,
  type ScoreSpread,
  type SpreadRow,
  type SubmissionScores,
} from './assessment/spread.ts';
export {
  attachmentListSchema,
  attachmentMessages,
  attachmentViewSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentList,
  type AttachmentView,
} from './attachments/answers.ts';
export {
  attachmentRoutes,
  downloadAttachment,
  downloadSubmissionAttachment,
  listAttachments,
  listSubmissionAttachments,
  removeAttachment,
  uploadAttachment,
} from './attachments/routes.ts';
export { grantsAuditActions, type GrantsAuditAction } from './audit.ts';
export {
  decisionListSchema,
  decisionRowSchema,
  decisionSchema,
  emailDeliverySchema,
  emailPreviewSchema,
  recordedSchema,
  releaseResultSchema,
  type Decision,
  type DecisionList,
  type DecisionRow,
  type EmailDelivery,
  type EmailPreview,
  type Recorded,
  type ReleaseResult,
} from './decisions/answers.ts';
export {
  renderTemplate,
  type MergeValues,
  type OutcomeTemplate,
  type RenderedEmail,
} from './decisions/email.ts';
export {
  bulkDecisionInputSchema,
  decisionInputSchema,
  MAX_DECISIONS,
  releaseInputSchema,
  type BulkDecisionInput,
  type DecisionInput,
  type ReleaseInput,
} from './decisions/inputs.ts';
export {
  decisionEmailErrorCodes,
  decisionEmailErrorCodeSchema,
  decisionEmailStatuses,
  decisionEmailStatusSchema,
  type DecisionEmailErrorCode,
  type DecisionEmailStatus,
} from './decisions/lists.ts';
export {
  decisionRoutes,
  listDecisions,
  previewDecisionEmail,
  recordDecision,
  recordDecisions,
  releaseDecisions,
  sendDecisionEmails,
} from './decisions/routes.ts';
export {
  amountAwarded,
  grantIdentifier,
  MAX_EXPORT_GRANTS,
  recipientOrganization,
  threeSixtyGivingExportSchema,
  threeSixtyGivingFileSchema,
  threeSixtyGivingGrantSchema,
  threeSixtyGivingQuerySchema,
  type RecipientOrganization,
  type ThreeSixtyGivingExport,
  type ThreeSixtyGivingFile,
  type ThreeSixtyGivingGrant,
  type ThreeSixtyGivingQuery,
} from './export/360giving.ts';
export { exportMessages, type ExportMessage } from './export/messages.ts';
export {
  publisherAnswerSchema,
  publisherSettingConfigEntityType,
  publisherSettingInputSchema,
  publisherSettingSchema,
  type PublisherAnswer,
  type PublisherSetting,
  type PublisherSettingInput,
} from './export/publisher.ts';
export {
  exportRoutes,
  get360GivingExport,
  getPublisherSetting,
  savePublisherSetting,
} from './export/routes.ts';
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
  eligibilityCheckSchema,
  stageMoveResultSchema,
  submissionCursorSchema,
  submissionEventSchema,
  submissionPageSchema,
  submissionSchema,
  submissionSummarySchema,
  type EligibilityCheck,
  type StageMoveResult,
  type Submission,
  type SubmissionEvent,
  type SubmissionPage,
  type SubmissionSummary,
} from './submissions/answers.ts';
export {
  MAX_STAGE_MOVE,
  stageMoveInputSchema,
  submissionQuerySchema,
  type StageMoveInput,
  type SubmissionQuery,
} from './submissions/inputs.ts';
export {
  getSubmission,
  listSubmissions,
  moveSubmissionsToStage,
  submissionRoutes,
} from './submissions/routes.ts';
export {
  defaultEmailTemplates,
  emailTemplatesInputSchema,
  mergeFields,
  mergeFieldsFor,
  mergeFieldsIn,
  type EmailTemplatesInput,
  type MergeField,
} from './programme/templates.ts';
