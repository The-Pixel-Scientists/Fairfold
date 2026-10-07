// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews of applicant screens not built yet, at /dev/preview in
// development builds only. They use the real components and a fixed
// synthetic story (story.ts), and are the designs the screens are built to.

import { Button, Link, Router, useLocation, useNavigate } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { SIGNED_OUT_PATH } from '../paths.ts';
import { PortalShell } from '../PortalShell.tsx';
import { productName } from '../product.ts';
import { applyRoutes } from './routes.ts';
import { applicant } from './story.ts';

/**
 * The shell, as a signed-in applicant sees it, and without the person once they
 * have signed out. A static host adds a trailing slash, so it is ignored.
 * Printing leaves out its skip link, header and footer.
 */
function PreviewShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="print:[&_:is(header,footer,a[href='#main-content']):not(main_*)]:hidden">
      <PortalShell
        actions={
          pathname.replace(/\/+$/, '') === SIGNED_OUT_PATH ? undefined : (
            <>
              <p className="text-body text-muted">{applicant.email}</p>
              <Button
                onClick={() => {
                  navigate(SIGNED_OUT_PATH);
                }}
              >
                Sign out
              </Button>
            </>
          )
        }
      >
        {children}
      </PortalShell>
    </div>
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
