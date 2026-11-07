// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * For a page that swaps one view for another in place: put the returned ref
 * on each view's heading and give the view's name. When the name changes
 * (not on first render, where the router has already placed focus), focus
 * moves to the new heading, so the swapped-out button does not leave focus
 * at the start of the document and screen readers read the new view.
 */
export function useFocusOnChange<T extends HTMLElement>(view: unknown): RefObject<T | null> {
  const heading = useRef<T>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    heading.current?.focus();
  }, [view]);
  return heading;
}
