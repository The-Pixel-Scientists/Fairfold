// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Focus and motion helpers shared by the skip link, the error summary and the
// router.

/** True when the person has asked their system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Scrolling is instant under reduced motion, and follows the page's own setting otherwise. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'instant' : 'auto';
}

/**
 * Move focus to an element that is not normally in the tab order, such as a
 * heading or a landmark. It gets `tabindex="-1"` first when it has no
 * tabindex of its own, so script can focus it but Tab still skips it.
 */
export function focusElement(element: HTMLElement, options?: FocusOptions): void {
  if (!element.hasAttribute('tabindex') && element.tabIndex < 0) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus(options);
}
