// SPDX-License-Identifier: AGPL-3.0-or-later

import { NotFoundPage, useCan } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { Gate } from './Gate.tsx';
import { SectionNav } from './SectionNav.tsx';

/**
 * A page for members with one permission, while crm is on. Anyone else gets
 * the page for an address that is not there, and the page makes no request.
 */
export function Needs({ permission, children }: { permission: string; children: ReactNode }) {
  return (
    <Gate>
      <Allowed permission={permission}>
        <SectionNav />
        {children}
      </Allowed>
    </Gate>
  );
}

function Allowed({ permission, children }: { permission: string; children: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <NotFoundPage />;
}
