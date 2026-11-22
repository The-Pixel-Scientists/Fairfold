// SPDX-License-Identifier: AGPL-3.0-or-later

import { listOwnBreakGlass } from '@pixel-scientists/domain/platform/team';
import {
  EmptyState,
  PageHeader,
  PageHeading,
  WhenLoaded,
  useCan,
  useLoad,
} from '@pixel-scientists/ui';

import { callApi } from '../../api.ts';
import { GrantsTable } from './GrantsTable.tsx';

const loadGrants = () => callApi(listOwnBreakGlass, {}).then(({ grants }) => grants);

function GrantsView() {
  const { state, retry } = useLoad(loadGrants);
  return (
    <>
      <PageHeader
        title="Emergency access"
        description="Records you opened in an emergency. Each ends by itself after one hour. To read a record again, open it again with a new reason."
      />
      <WhenLoaded state={state} label="Loading your emergency access" retry={retry}>
        {(grants) =>
          grants.length === 0 ? (
            <EmptyState title="No emergency access is open">
              <p>
                If you search for a record you cannot reach, you can open it in an emergency. You
                give a reason, and an administrator is alerted.
              </p>
            </EmptyState>
          ) : (
            <GrantsTable grants={grants} />
          )
        }
      </WhenLoaded>
    </>
  );
}

function Cannot() {
  return (
    <>
      <PageHeading>Emergency access</PageHeading>
      <EmptyState title="You cannot open records in an emergency">
        <p>Ask an administrator at your funder if you need this.</p>
      </EmptyState>
    </>
  );
}

/** The caller's own emergency access that has not ended. */
export default function EmergencyAccessPage() {
  const allowed = useCan('platform.break_glass.use');
  return <div className="flex flex-col gap-stack">{allowed ? <GrantsView /> : <Cannot />}</div>;
}
