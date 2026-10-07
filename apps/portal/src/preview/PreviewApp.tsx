// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews of applicant screens not built yet, at /dev/preview in
// development builds only. They use the real components and a fixed
// synthetic story (story.ts), and are the designs the screens are built to.

import { Button, Link, Router } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { PortalShell } from '../PortalShell.tsx';
import { productName } from '../product.ts';
import { applyRoutes } from './routes.ts';
import { applicant } from './story.ts';

function PreviewShell({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      actions={
        <>
          <p className="text-body text-muted">{applicant.email}</p>
          <Button>Sign out</Button>
        </>
      }
    >
      {children}
    </PortalShell>
  );
}

function PreviewIndex() {
  return (
    <PageColumn>
      <PageIntro title="Design previews">
        <p>Screens still being built, on synthetic data. Nothing here reaches the API.</p>
      </PageIntro>
      <ul className="flex flex-col gap-2 text-lg">
        {applyRoutes.map(({ path, title }) => (
          <li key={path}>
            <Link to={path}>{typeof title === 'string' ? title : path}</Link>
          </li>
        ))}
      </ul>
    </PageColumn>
  );
}

export default function PreviewApp() {
  return (
    <Router
      routes={[{ path: '/', title: 'Design previews', component: PreviewIndex }, ...applyRoutes]}
      basePath={
        import.meta.env.MODE === 'demo'
          ? import.meta.env.BASE_URL.replace(/\/$/, '')
          : '/dev/preview'
      }
      layout={PreviewShell}
      titleSuffix={productName}
    />
  );
}
