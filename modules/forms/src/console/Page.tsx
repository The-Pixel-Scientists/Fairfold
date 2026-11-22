// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { buttonClassName, Link, NotFoundPage, useCan, useParams } from '@pixel-scientists/ui';
import type { ButtonVariant } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

/** A parameter of the page's address. The route has checked that it is an id. */
export function useParam(name: string): string {
  return useParams()[name] ?? '';
}

/**
 * Every forms page opens inside this. Someone without the permission, or in
 * a funder where the tool is off, sees the same page as for any address that
 * is not there, and nothing of the screen.
 */
export function FormsPage({
  permission = 'forms.forms.manage',
  children,
}: {
  permission?: string;
  children: ReactNode;
}) {
  return useCan(permission) ? (
    <div className="flex flex-col gap-stack">{children}</div>
  ) : (
    <NotFoundPage />
  );
}

/** Reads something, giving null for a 404, which is how a record in another funder looks too. */
export async function orMissing<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ProblemError && error.status === 404) return null;
    throw error;
  }
}

/** A link that looks like a button, for going to another page. */
export function LinkButton({
  to,
  variant = 'secondary',
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClassName(variant)}>
      {children}
    </Link>
  );
}
