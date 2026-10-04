// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { productName } from '../product.ts';

/** The frame around the sign-in, sign-up and similar pages: no navigation, one narrow column. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <AppShell productName={productName} areaName="Staff console">
      <div className="mx-auto flex w-full max-w-md flex-col gap-stack">{children}</div>
    </AppShell>
  );
}
