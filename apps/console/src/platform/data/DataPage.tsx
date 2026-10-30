// SPDX-License-Identifier: AGPL-3.0-or-later

import { ThreeSixtyGivingSection } from '@pixel-scientists/grants/console';
import { EmptyState, LoadingState, PageHeader, PageHeading, useCan } from '@pixel-scientists/ui';
import { Suspense } from 'react';

import { WarehouseSection } from './WarehouseSection.tsx';

/** The funder's downloads: the 360Giving file and the warehouse snapshot, each for those who may take it. */
export default function DataPage() {
  const threeSixtyGiving = useCan('grants.data.export');
  const warehouse = useCan('platform.warehouse.export');
  if (!threeSixtyGiving && !warehouse) {
    return (
      <div className="flex flex-col gap-stack">
        <PageHeading>Data</PageHeading>
        <EmptyState title="You cannot download data">
          <p>Ask an administrator at your funder to give you access.</p>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Data"
        description="Download your data in open formats. Neither download holds personal details, and only awards you have released are included."
      />
      {threeSixtyGiving && (
        <Suspense
          fallback={
            <LoadingState label="Loading the 360Giving file" className="rounded-lg bg-surface" />
          }
        >
          <ThreeSixtyGivingSection />
        </Suspense>
      )}
      {warehouse && <WarehouseSection />}
    </div>
  );
}
