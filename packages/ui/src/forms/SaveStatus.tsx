// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '../cx.ts';

export type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'saved'; readonly at: Date }
  | { readonly status: 'failed' };

export interface SaveStatusProps {
  state: SaveState;
  className?: string;
}

/** As the content style guide writes a time: "2:14pm", and "2pm" on the hour. */
function clockTime(time: Date): string {
  const hours = time.getHours();
  const minutes = time.getMinutes();
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const past = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
  return `${String(hour)}${past}${hours < 12 ? 'am' : 'pm'}`;
}

function textOf(state: SaveState): string {
  switch (state.status) {
    case 'idle':
      return '';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return `Saved at ${clockTime(state.at)}`;
    case 'failed':
      return 'Not saved. Check your connection and try again';
  }
}

/**
 * Says whether an answer is safe: "Saving…", "Saved at 2:14pm", or "Not
 * saved. Check your connection and try again". The element is on the page
 * from the start, so a screen reader announces each change politely. Nothing
 * is shown before the first save.
 */
export function SaveStatus({ state, className }: SaveStatusProps) {
  return (
    <p
      role="status"
      className={cx(
        'text-body',
        state.status === 'failed' ? 'font-medium text-danger' : 'text-muted',
        className,
      )}
    >
      {textOf(state)}
    </p>
  );
}
