// SPDX-License-Identifier: AGPL-3.0-or-later

import { modules } from '@pixel-scientists/domain/platform';
import type { ApprovalRequest } from '@pixel-scientists/domain/workflow';
import {
  Button,
  DataTable,
  EmptyState,
  Link,
  NotFoundPage,
  PageHeader,
  WhenLoaded,
  formatTime,
  stepLabel,
  useCan,
  useLoad,
  useNavigate,
  useSession,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { loadInbox, loadMore } from './calls.ts';
import { approvalPath } from './paths.ts';

const moduleLabel = ({ definitionKey }: ApprovalRequest): string => {
  const id = definitionKey.split('.')[0] ?? '';
  return id in modules ? modules[id as keyof typeof modules].label : id;
};

interface Later {
  requests: readonly ApprovalRequest[];
  nextCursor: string | null;
}

function Inbox() {
  const { state, retry } = useLoad(loadInbox);
  const { state: session } = useSession();
  const navigate = useNavigate();
  const [later, setLater] = useState<Later | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const selfId = session.status === 'ready' ? (session.session.activeMembership?.id ?? '') : '';

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Requests waiting for your decision. Open one to approve or reject it."
      />
      <WhenLoaded state={state} label="Loading approvals" retry={retry}>
        {({ page, zone }) => {
          const requests = [...page.requests, ...(later?.requests ?? [])];
          const nextCursor = later === null ? page.nextCursor : later.nextCursor;
          const columns: readonly Column<ApprovalRequest>[] = [
            {
              key: 'step',
              header: 'Request',
              rowHeader: true,
              cell: (request) => <Link to={approvalPath(request.id)}>{stepLabel(request)}</Link>,
            },
            { key: 'module', header: 'Tool', cell: moduleLabel },
            {
              key: 'by',
              header: 'Requested by',
              cell: ({ requestedBy }) => (requestedBy === selfId ? 'You' : 'A colleague'),
            },
            {
              key: 'at',
              header: 'Requested',
              cell: ({ requestedAt }) => formatTime(requestedAt, zone ?? undefined),
            },
            {
              key: 'approvals',
              header: 'Approvals',
              align: 'end',
              cell: ({ approvals, requiredApprovals }) =>
                `${String(approvals)} of ${String(requiredApprovals)}`,
            },
          ];
          const showMore = () => {
            if (loading || nextCursor === null) return;
            setLoading(true);
            setFailed(false);
            loadMore(nextCursor)
              .then(
                (next) => {
                  setLater({
                    requests: [...(later?.requests ?? []), ...next.requests],
                    nextCursor: next.nextCursor,
                  });
                },
                () => {
                  setFailed(true);
                },
              )
              .finally(() => {
                setLoading(false);
              });
          };
          return (
            <section className="flex flex-col gap-3">
              <DataTable
                caption="Approvals waiting for your decision"
                captionHidden
                columns={columns}
                rows={requests}
                rowKey={({ id }) => id}
                onOpenRow={({ id }) => {
                  navigate(approvalPath(id));
                }}
                empty={
                  <EmptyState title="Nothing is waiting for you" headingLevel="h2">
                    <p>
                      When a colleague asks for your approval, the request appears here. Check back
                      later.
                    </p>
                  </EmptyState>
                }
              />
              {failed && (
                <p role="alert" className="text-body font-medium text-danger">
                  The next requests did not load. Try again.
                </p>
              )}
              {nextCursor !== null && (
                <div>
                  <Button aria-disabled={loading || undefined} onClick={showMore}>
                    Load more
                  </Button>
                </div>
              )}
            </section>
          );
        }}
      </WhenLoaded>
    </>
  );
}

/** The requests waiting for the signed-in member's decision. The server lists only what they may decide. */
export default function InboxPage() {
  return useCan('platform.approvals.read') ? (
    <div className="flex flex-col gap-stack">
      <Inbox />
    </div>
  ) : (
    <NotFoundPage />
  );
}
