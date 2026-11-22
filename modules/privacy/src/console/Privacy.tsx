// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy tool's staff screens. The console opens the tool at one path,
// so this picks the screen from the search string and shows only the screens
// the member holds the permission for; the server still checks every request.

import { idSchema } from '@pixel-scientists/domain';
import {
  Button,
  Dialog,
  Link,
  LoadingState,
  NotFoundPage,
  useCan,
  useSearch,
} from '@pixel-scientists/ui';
import type { SearchSchema } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { BreachPage } from './breaches/BreachPage.tsx';
import { BreachesPage } from './breaches/BreachesPage.tsx';
import { ConsentPage } from './consent/ConsentPage.tsx';
import { DpiaPage } from './dpia/DpiaPage.tsx';
import { DpiasPage } from './dpia/DpiasPage.tsx';
import { UnsavedContext, useRead, ZoneContext } from './hooks.ts';
import { loadTimeZone } from './loaders.ts';
import { viewPath, views } from './paths.ts';
import type { View } from './paths.ts';
import { ProcessingPage } from './processing/ProcessingPage.tsx';
import { RequestPage } from './requests/RequestPage.tsx';
import { RequestsPage } from './requests/RequestsPage.tsx';

interface Address {
  view: View | undefined;
  id: string | undefined;
}

/** Anything but a known screen and a real id is not found, whatever else the address says. */
const searchSchema: SearchSchema<Address> = {
  safeParse(input) {
    const { view, id } = input as Record<string, unknown>;
    const knownView =
      view === undefined || (typeof view === 'string' && views.some((v) => v === view));
    const knownId =
      id === undefined ||
      id === 'new' ||
      (typeof id === 'string' && idSchema.safeParse(id).success);
    return knownView && knownId
      ? { success: true, data: { view: view as View | undefined, id: id } }
      : { success: false, error: null };
  },
};

const sections = [
  { view: 'requests', label: 'Requests', permission: 'privacy.requests.manage' },
  { view: 'breaches', label: 'Breaches', permission: 'privacy.breaches.manage' },
  { view: 'dpias', label: 'DPIAs', permission: 'privacy.dpias.manage' },
  { view: 'processing', label: 'Records of processing', permission: 'privacy.processing.manage' },
] as const satisfies readonly { view: View; label: string; permission: string }[];

/** The section a screen belongs to, so its link in the navigation is marked as the current one. */
const sectionOf: Record<View, (typeof sections)[number]['view']> = {
  requests: 'requests',
  request: 'requests',
  consent: 'requests',
  breaches: 'breaches',
  breach: 'breaches',
  dpias: 'dpias',
  dpia: 'dpias',
  processing: 'processing',
};

export default function Privacy() {
  const search = useSearch(searchSchema);
  const can = {
    'privacy.requests.manage': useCan('privacy.requests.manage'),
    'privacy.breaches.manage': useCan('privacy.breaches.manage'),
    'privacy.dpias.manage': useCan('privacy.dpias.manage'),
    'privacy.processing.manage': useCan('privacy.processing.manage'),
  };
  const allowed = sections.filter(({ permission }) => can[permission]);
  const { state } = useRead(loadTimeZone);
  const unsaved = useRef(false);
  const [leaving, setLeaving] = useState<HTMLAnchorElement | null>(null);

  const view = search.success ? (search.data.view ?? allowed[0]?.view) : undefined;
  const id = search.success ? search.data.id : undefined;
  const screen = view === undefined ? undefined : `${view}:${id ?? ''}`;

  // A change of screen is not a change of page, so the router does not move focus: do it here.
  const shown = useRef(screen);
  useEffect(() => {
    if (shown.current === screen) return;
    shown.current = screen;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [screen]);

  if (view === undefined || !allowed.some(({ view: section }) => section === sectionOf[view])) {
    return <NotFoundPage />;
  }

  let page: ReactNode = <NotFoundPage />;
  switch (view) {
    case 'requests':
      page = <RequestsPage />;
      break;
    case 'request':
      if (id !== undefined && id !== 'new') page = <RequestPage requestId={id} />;
      break;
    case 'consent':
      if (id !== undefined && id !== 'new') page = <ConsentPage personId={id} />;
      break;
    case 'breaches':
      page = <BreachesPage />;
      break;
    case 'breach':
      if (id !== undefined && id !== 'new') page = <BreachPage breachId={id} />;
      break;
    case 'dpias':
      page = <DpiasPage />;
      break;
    case 'dpia':
      if (id !== undefined) page = <DpiaPage dpiaId={id} />;
      break;
    case 'processing':
      page = <ProcessingPage />;
      break;
  }

  // Moving between screens only changes the search string, which the router's leave guard ignores.
  function askBeforeLeaving(event: MouseEvent) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey;
    if (!unsaved.current || !(link instanceof HTMLAnchorElement) || !plain) return;
    event.preventDefault();
    event.stopPropagation();
    setLeaving(link);
  }

  return (
    <div className="flex flex-col gap-stack" onClickCapture={askBeforeLeaving}>
      <nav
        aria-label="Privacy"
        className="flex flex-wrap gap-x-5 shadow-[inset_0_-1px_0_var(--color-divider)]"
      >
        {allowed.map(({ view: section, label }) => (
          <Link
            key={section}
            to={viewPath(section)}
            aria-current={sectionOf[view] === section ? 'page' : undefined}
            className="-mb-px inline-flex min-h-target items-center border-b-2 border-transparent px-1 text-body font-medium text-muted hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink"
          >
            {label}
          </Link>
        ))}
      </nav>
      {state.status === 'ready' ? (
        <UnsavedContext.Provider
          value={(dirty) => {
            unsaved.current = dirty;
          }}
        >
          <ZoneContext.Provider value={state.value}>{page}</ZoneContext.Provider>
        </UnsavedContext.Provider>
      ) : (
        <LoadingState label="Loading privacy" className="rounded-lg bg-surface" />
      )}
      <Dialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title="Leave this page?"
        description="You have unsaved changes. If you leave this page, you will lose them."
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setLeaving(null);
              }}
            >
              Stay on this page
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const link = leaving;
                unsaved.current = false;
                setLeaving(null);
                link?.click();
              }}
            >
              Leave and lose changes
            </Button>
          </>
        }
      />
    </div>
  );
}
