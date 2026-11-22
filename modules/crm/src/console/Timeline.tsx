// SPDX-License-Identifier: AGPL-3.0-or-later

import { moduleOn } from '@pixel-scientists/domain/platform';
import {
  Button,
  DataTable,
  Link,
  Panel,
  WhenLoaded,
  asProblem,
  hasPermission,
  useLoad,
  useSession,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { Interaction, TimelinePage } from '../contracts/index.ts';
import { toolsOn } from './Gate.tsx';
import { loadTimeline } from './loaders.ts';
import { formatMoment, interactionWords, moduleWords } from './words.ts';

/**
 * The page of the record an item names, when its tool is on and the member
 * may open it. Everything else shows its kind and time with no link.
 */
export function sourcePath(
  item: Interaction,
  session: { permissions: readonly string[] },
): string | null {
  const { source } = item;
  if (source === null || !moduleOn(source.module, toolsOn(session).includes(source.module))) {
    return null;
  }
  return source.entityType === 'grants.application' &&
    hasPermission(session, 'grants.applications.read')
    ? `/submissions/${source.entityId}`
    : null;
}

function Items({ partyId, first }: { partyId: string; first: TimelinePage }) {
  const { state } = useSession();
  const [items, setItems] = useState(first.interactions);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function more() {
    if (cursor === null || pending) return;
    setPending(true);
    try {
      const page = await loadTimeline(partyId, cursor);
      setItems([...items, ...page.interactions]);
      setCursor(page.nextCursor);
      setProblem(null);
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  }

  const columns: readonly Column<Interaction>[] = [
    {
      key: 'when',
      header: 'When',
      rowHeader: true,
      cell: (item) => formatMoment(item.occurredAt),
    },
    { key: 'kind', header: 'What happened', cell: (item) => interactionWords[item.kind] },
    { key: 'source', header: 'Tool', cell: (item) => moduleWords(item.module) },
    {
      key: 'details',
      header: 'Details',
      cell: (item) => {
        const path = state.status === 'ready' ? sourcePath(item, state.session) : null;
        return (
          <div className="flex min-w-48 max-w-prose flex-col gap-1 whitespace-pre-wrap">
            {item.summary !== null && <span>{item.summary}</span>}
            {path !== null && <Link to={path}>Open the application</Link>}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        caption="Timeline"
        captionHidden
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
        empty={
          <p className="text-muted">
            Nothing has happened with this record yet. Applications and decisions appear here.
          </p>
        }
      />
      {problem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
      {cursor !== null && (
        <div>
          <Button onClick={() => void more()} aria-disabled={pending || undefined}>
            Show more of the timeline
          </Button>
        </div>
      )}
    </>
  );
}

/** What has happened with a record, newest first. Another tool's items hold only what the timeline carries. */
export function Timeline({ partyId }: { partyId: string }) {
  const { state, retry } = useLoad(loadTimeline, partyId);
  return (
    <Panel title="Timeline">
      <WhenLoaded state={state} label="Loading the timeline" retry={retry}>
        {(first) => <Items partyId={partyId} first={first} />}
      </WhenLoaded>
    </Panel>
  );
}
