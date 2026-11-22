// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@pixel-scientists/ui';

import type { Pages } from './pages.ts';

interface Props {
  /** What the rows are, in the plural: "forms" or "responses". */
  noun: string;
  state: Extract<Pages<unknown>, { status: 'ready' }>;
  onClick: () => void;
}

/** The button under a list that loads a page at a time, with its live region. */
export function ShowMore({ noun, state, onClick }: Props) {
  const failed = state.more === 'failed';
  let message = '';
  if (state.more === 'loading') message = `Loading more ${noun}`;
  else if (failed) message = `We could not load more ${noun}. Try again.`;
  else if (state.added > 0)
    message = `More ${noun} loaded. Showing ${String(state.items.length)} in all.`;

  return (
    <div className="flex flex-col items-start gap-2">
      {state.next !== null && (
        <Button aria-disabled={state.more === 'loading' || undefined} onClick={onClick}>
          {`Show more ${noun}`}
        </Button>
      )}
      <p role="status" className={failed ? 'text-body text-danger' : 'text-body'}>
        {message}
      </p>
    </div>
  );
}
