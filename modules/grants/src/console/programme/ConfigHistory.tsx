// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Panel, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useId, useState } from 'react';

import type { ConfigHistory as History, ConfigVersion } from '../../contracts/index.ts';
import { formatMoment } from './format.ts';
import { describe, summarise } from './historyWords.ts';
import type { Names } from './historyWords.ts';

/** How many versions show before the rest are asked for. */
const RECENT = 4;

function Version({
  version,
  names,
  timeZone,
}: {
  version: ConfigVersion;
  names: Names;
  timeZone: string | undefined;
}) {
  const summary = summarise(version, names);
  return (
    <li className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
      <span className="font-medium text-ink">{summary}</span>
      <span className="text-sm text-muted">
        {version.author.name ?? 'A team member'},{' '}
        <time dateTime={version.createdAt}>{formatMoment(version.createdAt, timeZone)}</time>
      </span>
      <details className="group">
        <summary className="inline-flex min-h-target cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-ink marker:hidden [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 text-muted transition-transform duration-(--motion-fast) group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
          See what changed<span className="sr-only"> in version {version.version}</span>
        </summary>
        <dl className="mt-1 flex flex-col gap-2 border-l-2 border-divider pl-3 text-sm">
          {describe(version.changes, names).map((change, index) => (
            <div key={index} className="flex flex-col gap-0.5">
              <dt className="font-medium text-ink">{change.field}</dt>
              <dd className="break-words whitespace-pre-line text-muted">
                Before: {change.before}
              </dd>
              <dd className="break-words whitespace-pre-line text-ink">After: {change.after}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

function Versions({
  versions,
  names,
  timeZone,
}: {
  versions: readonly ConfigVersion[];
  names: Names;
  timeZone: string | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const older = versions.length - RECENT;

  if (versions.length === 0) return <p className="text-body text-muted">No changes saved yet.</p>;
  return (
    <>
      <ol id={listId} role="list" className="flex flex-col divide-y divide-divider">
        {(showAll ? versions : versions.slice(0, RECENT)).map((version) => (
          <Version key={version.version} version={version} names={names} timeZone={timeZone} />
        ))}
      </ol>
      {older > 0 && (
        <Button
          variant="quiet"
          aria-expanded={showAll}
          aria-controls={listId}
          className="-ml-control-x self-start"
          onClick={() => {
            setShowAll((current) => !current);
          }}
        >
          {showAll ? 'Show recent changes only' : `Show ${String(older)} older changes`}
        </Button>
      )}
    </>
  );
}

/**
 * Who changed what and when, newest first, read with `load` for `id`. Times
 * show in `timeZone`, or the browser's own. A stage or criterion is named
 * from `names` when a version does not name it.
 */
export function ConfigHistory({
  load,
  id,
  names = new Map(),
  timeZone,
}: {
  load: (id: string) => Promise<History>;
  id: string;
  names?: Names;
  timeZone?: string;
}) {
  const { state, retry } = useLoad(load, id);
  return (
    <Panel title="Configuration history">
      <p className="-mt-2 text-sm text-muted">
        Every change is saved as a version, with who made it and what changed.
      </p>
      <WhenLoaded state={state} label="Loading the history" retry={retry}>
        {({ versions }) => <Versions versions={versions} names={names} timeZone={timeZone} />}
      </WhenLoaded>
    </Panel>
  );
}
