// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The pages the router shows when it has nothing better: an unknown address,
// and a page that failed to load.

import { Component } from 'react';
import type { ReactNode } from 'react';

import { Button, buttonClassName } from '../Button.tsx';
import { PageHeading } from '../PageHeading.tsx';
import { Link } from './Link.tsx';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-4">
      <PageHeading>Page not found</PageHeading>
      <p className="max-w-prose text-body text-muted">
        There is no page at this address. Check it for typing mistakes, or go to the home page.
      </p>
      <Link to="/" className={buttonClassName('primary')}>
        Go to the home page
      </Link>
    </div>
  );
}

export function RouteErrorPage() {
  return (
    <div className="flex flex-col items-start gap-4">
      <PageHeading>This page did not load</PageHeading>
      <p className="max-w-prose text-body text-muted">
        Check your connection, then reload the page. If it still does not load, tell your
        administrator.
      </p>
      <Button
        variant="primary"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload page
      </Button>
    </div>
  );
}

interface RouteErrorBoundaryProps {
  /** Changes with the page, so going somewhere else clears an earlier failure. */
  resetKey: string;
  /** Called once when a page fails, so the router can retitle and announce the error page. */
  onError: () => void;
  /** What to show in place of the page that failed. */
  fallback: ReactNode;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  failed: boolean;
  /** The page that failed. Null until the boundary has seen which page it was. */
  failedKey: string | null;
}

/** Catches a page that fails to load or to render, and shows the fallback instead. */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { failed: false, failedKey: null };

  static getDerivedStateFromError(): Partial<RouteErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    // Only a change after the failure has been recorded clears it. The render
    // that fails also carries the new key, and must not undo its own error.
    if (state.failed && state.failedKey !== null && state.failedKey !== props.resetKey) {
      return { failed: false, failedKey: null };
    }
    return null;
  }

  override componentDidCatch(): void {
    this.setState({ failedKey: this.props.resetKey });
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
