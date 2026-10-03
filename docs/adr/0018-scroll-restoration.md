# ADR 0018: Scroll restoration in the router

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** Aaron Gardner

## Context

[ADR 0014](0014-client-side-routing.md) chose a small history router in
`packages/ui`. One of the rules its tests pin down says that after each
navigation the router "scrolls to the top". That loses the person's place
when they go back to a long list, such as the submissions list, which is a
common way to work through applications one by one.

While fixing S01-05, the router was changed to restore the scroll position on
back and forward, and to show a loading message for slow pages and an error
page for pages that fail. This ADR records those rules so they replace the
sentence in ADR 0014.

## Options considered

1. **Always start at the top,** as ADR 0014 says. Simple, but going back to a
   long list means finding your place again, which is slow for everyone and
   harder for screen reader and keyboard users.
2. **Let the browser restore scrolling** (`history.scrollRestoration =
   "auto"`). The browser restores before a lazily loaded page has rendered,
   so it often lands in the wrong place.
3. **The router restores scrolling itself,** remembering a position for each
   history entry during the session.

## Decision

Option 3. This replaces the second rule under "Rules the tests pin down" in
ADR 0014:

- After each navigation the router sets the document title, moves focus to
  the page's `h1`, which has `tabindex="-1"`, and announces the new page's
  title.
- Following a link or calling `navigate` starts the new page at the top.
- The back and forward buttons return to the scroll position the person left,
  and focus the `h1` without scrolling. The router sets
  `history.scrollRestoration` to `manual` and remembers positions for each
  history entry, for the session.
- Scrolling is instant under `prefers-reduced-motion`.
- A page still loading after 400 ms shows and announces "Loading <title>…"
  through the same polite live region.
- A page that fails to load shows the error page, with its title,
  announcement and focus, even on the first load.
- The first page load that succeeds keeps the browser's own focus.

ADR 0014's other rules are unchanged.

## Consequences

- People going back to a list land where they were, with focus on the page
  heading.
- Component tests cover each rule above, and the e2e tests cover back and
  forward on a page long enough to scroll.
- Positions are kept only in memory, so they are lost on reload; a reload
  starts at the top.
- The manual screen reader check before M1 confirms that the announcement is
  not read twice alongside the focused heading.

## Dependency check

No dependency is added.
