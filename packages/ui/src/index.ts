// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The component library shared by the console and the portal. Apps import
// from here and never from Radix directly (ADR 0006). Import the stylesheet
// once per app: `@pixel-scientists/ui/styles.css`.

export { AppShell, MAIN_CONTENT_ID } from './AppShell.tsx';
export type { AppShellProps } from './AppShell.tsx';
export { Button, buttonClassName } from './Button.tsx';
export type { ButtonProps, ButtonVariant } from './Button.tsx';
export { EmptyState } from './EmptyState.tsx';
export type { EmptyStateProps } from './EmptyState.tsx';
export { ErrorSummary } from './ErrorSummary.tsx';
export type { ErrorSummaryItem, ErrorSummaryProps } from './ErrorSummary.tsx';
export { FormField, Input, Select, Textarea, useFormFieldControl } from './FormField.tsx';
export type {
  FormFieldControlProps,
  FormFieldProps,
  InputProps,
  SelectProps,
  TextareaProps,
} from './FormField.tsx';
export { LoadingState } from './LoadingState.tsx';
export type { LoadingStateProps } from './LoadingState.tsx';
export { PageHeading } from './PageHeading.tsx';
export type { PageHeadingProps } from './PageHeading.tsx';
export { RadioGroup } from './RadioGroup.tsx';
export type { RadioGroupProps, RadioOption } from './RadioGroup.tsx';
export { SkipLink } from './SkipLink.tsx';
export type { SkipLinkProps } from './SkipLink.tsx';
export { cx } from './cx.ts';
export * from './auth/index.ts';
export * from './dialog/index.ts';
export * from './session/index.ts';
export * from './router/index.ts';
export * from './theme/index.ts';
