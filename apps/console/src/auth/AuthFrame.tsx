// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { productName } from '../product.ts';

/** The frame around the sign-in, sign-up and similar pages: no navigation, one narrow column on a sheet. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <AppShell productName={productName} areaName="Staff console">
      <div className="mx-auto w-full max-w-md sm:py-8">
        <div className="flex flex-col gap-stack sm:rounded-lg sm:border sm:border-divider sm:bg-surface sm:p-8 sm:shadow-(--shadow-raised)">
          {children}
        </div>
      </div>
    </AppShell>
  );
}
