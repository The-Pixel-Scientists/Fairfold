// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, EmptyState, Link, LoadingState, PageHeading, useCan } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { Screen } from '../../auth/Screen.tsx';
import { tabLinkClassName } from '../../shell/navLink.ts';
import type { Loaded } from './useLoad.ts';

const sections = [
  { to: '/settings', label: 'General' },
  { to: '/settings/look', label: 'Look' },
  { to: '/settings/modules', label: 'Modules' },
] as const;

function Sections() {
  return (
    <nav aria-label="Settings">
      <ul role="list" className="flex flex-wrap gap-x-6 border-b border-divider">
        {sections.map((section) => (
          <li key={section.to}>
            <Link to={section.to} className={tabLinkClassName}>
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const allowed = useCan('platform.settings.manage');
  if (!allowed) {
    return (
      <div className="flex flex-col gap-stack">
        <PageHeading>Settings</PageHeading>
        <EmptyState title="You cannot change this funder's settings">
          <p>Ask an administrator at your funder to change them, or to give you access.</p>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <PageHeading>{title}</PageHeading>
      <Sections />
      {children}
    </div>
  );
}

/** The frame of every settings page: the member's screen, the title, and the pages of the section. */
export function SettingsFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen kind="member">
      <Frame title={title}>{children}</Frame>
    </Screen>
  );
}

/** A settings card: one thing to change, with its own heading and save button. */
export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-divider bg-surface p-gutter shadow-(--shadow-raised) sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Shows what a read of the API gave: the loading state, a way to try again, or the page once it is ready. */
export function WhenLoaded<T>({
  state,
  label,
  retry,
  children,
}: {
  state: Loaded<T>;
  label: string;
  retry: () => void;
  children: (value: T) => ReactNode;
}) {
  if (state.status === 'loading')
    return <LoadingState label={label} className="rounded-lg bg-surface" />;
  if (state.status === 'failed') {
    return (
      <EmptyState
        title="We could not load this page"
        action={<Button onClick={retry}>Try again</Button>}
      >
        <p>{state.message}</p>
      </EmptyState>
    );
  }
  return children(state.value);
}
