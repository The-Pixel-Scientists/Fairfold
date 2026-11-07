// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

/**
 * Moves focus to a form's first control when the form appears, so keyboard and
 * screen reader users land in a form that opens away from the button they used.
 */
export function useFocusFirst() {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const first = form.current?.elements.item(0);
    if (first instanceof HTMLElement) first.focus();
  }, []);
  return form;
}
