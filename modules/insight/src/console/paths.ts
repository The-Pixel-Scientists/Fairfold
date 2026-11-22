// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of insight's screens: the tool's one path, and the screen
// named in its search string.

import { idSchema } from '@pixel-scientists/domain';
import { moduleIds } from '@pixel-scientists/domain/platform';
import type { SearchSchema } from '@pixel-scientists/ui';

export const INSIGHT_PATH = '/insight';

export const views = [
  'reports',
  'report',
  'report-new',
  'report-edit',
  'publication',
  'publication-new',
  'publication-run',
  'disclosure',
  'contracts',
  'contract',
] as const;

export type View = (typeof views)[number];

export interface Address {
  view: View;
  id?: string;
  module?: string;
}

/** Reads the search string. An address someone edited by hand that names nothing real falls back to the list of reports. */
export const addressSchema: SearchSchema<Address> = {
  safeParse(input) {
    const { view, id, module } = input as Record<string, unknown>;
    const known = views.find((name) => name === view);
    const validId = idSchema.safeParse(id);
    return {
      success: true,
      data: {
        view: known ?? 'reports',
        ...(validId.success ? { id: validId.data } : {}),
        ...(typeof module === 'string' && moduleIds.some((name) => name === module)
          ? { module }
          : {}),
      },
    };
  },
};

export function insightPath(view: View, target?: { id?: string; module?: string }): string {
  const search = new URLSearchParams({ view });
  if (target?.id !== undefined) search.set('id', target.id);
  if (target?.module !== undefined) search.set('module', target.module);
  return `${INSIGHT_PATH}?${search.toString()}`;
}

/** The proxied, audited download of a run's output file (S11-74). */
export const downloadPath = (runId: string) => `/api/console/publication-runs/${runId}/download`;
