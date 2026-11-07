// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form builder, shared by every tool that builds a form. It imports no
// module: a screen gives it the draft, the problems and callbacks, and does
// the saving, publishing and importing itself.

export { ConfirmDialog } from './ConfirmDialog.tsx';
export type { ConfirmDialogProps } from './ConfirmDialog.tsx';
export { firstSelection, FormEditor } from './FormEditor.tsx';
export type { FormEditorProps } from './FormEditor.tsx';
export { Preview } from './Preview.tsx';
export {
  flaggedIds,
  inWords,
  loweredProblems,
  messagesAt,
  placeOf,
  problemsOf,
  refusedProblems,
  summaryOf,
} from './problems.ts';
export type { Path, Place, Problem, Selection } from './problems.ts';
