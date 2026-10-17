// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { LinkButton } from './Page.tsx';

/**
 * The end of a form: the button that saves, a link back, and what has
 * happened. The status is on the page from the start, so a screen reader
 * announces it when it appears.
 */
export function FormFooter({
  save,
  pending,
  back,
  backTo,
  saved,
}: {
  save: string;
  pending: boolean;
  back: string;
  backTo: string;
  /** Said after a save, such as "Programme saved." Leave it empty before. */
  saved: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
        {save}
      </Button>
      <LinkButton to={backTo}>{back}</LinkButton>
      <p role="status" className="text-body font-medium text-success">
        {saved}
      </p>
    </div>
  );
}
