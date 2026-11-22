// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The embed entry (ADR 0035): a form anyone can answer, shown in a frame on
// the funder's website from the embed origin, which serves only this. The
// address is `/<slug>/forms/<form id>`. There is no session, no sign-in and
// no portal navigation here, and the page sets no cookie.

import { PageHeading } from '@pixel-scientists/ui';

import { FunderProvider, useFunder } from '../funder.tsx';
import { TenantProvider, tenantSlugOf } from '../tenant.ts';
import { EmbedLayout } from './EmbedLayout.tsx';
import { PublicFormRouter, isPublicFormPath } from './PublicFormRouter.tsx';

function NotFound() {
  return (
    <main className="mx-auto flex max-w-prose flex-col items-start gap-4 p-4 sm:p-6">
      <PageHeading className="text-3xl">We cannot find this form</PageHeading>
      <p className="text-lg text-ink">
        Check the link for typing mistakes. The form may have closed, or it may be only for people
        who sign in.
      </p>
    </main>
  );
}

function Form({ slug }: { slug: string }) {
  const funder = useFunder();
  return funder?.status === 'missing' ? (
    <NotFound />
  ) : (
    <PublicFormRouter slug={slug} embedded layout={EmbedLayout} />
  );
}

export function EmbedApp() {
  const { pathname } = window.location;
  const slug = tenantSlugOf(pathname);
  if (slug === null || !isPublicFormPath(slug, pathname)) return <NotFound />;
  return (
    <TenantProvider value={slug}>
      <FunderProvider>
        <Form slug={slug} />
      </FunderProvider>
    </TenantProvider>
  );
}
