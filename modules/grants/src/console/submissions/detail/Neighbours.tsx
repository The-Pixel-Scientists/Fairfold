// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, buttonClassName, Link, useLoad } from '@pixel-scientists/ui';
import { useMemo } from 'react';

import type { SubmissionQuery } from '../../../contracts/index.ts';
import { loadNeighbours } from '../loaders.ts';
import type { Neighbours as Found } from '../loaders.ts';
import { submissionPath } from '../paths.ts';
import { searchOf } from '../query.ts';

interface Place {
  query: SubmissionQuery;
  id: string;
}

const read = ({ query, id }: Place) => loadNeighbours(query, id);

const none: Found = { previous: null, next: null };

function Step({ to, direction }: { to: Found['next']; direction: 'Previous' | 'Next' }) {
  const label = (
    <>
      {direction}
      <span className="sr-only"> submission</span>
    </>
  );
  // At the end of the list the button stays, marked unavailable, so focus has somewhere to be.
  return to === null ? (
    <Button aria-disabled="true">{label}</Button>
  ) : (
    <Link to={submissionPath(to.id, searchOf(to.query))} className={buttonClassName()}>
      {label}
    </Link>
  );
}

/** "Previous" and "Next" through the list this submission was opened from, with its filters. */
export function Neighbours({ query, id }: Place) {
  const place = useMemo(() => ({ query, id }), [query, id]);
  const { state } = useLoad(read, place);
  const found = state.status === 'ready' ? state.value : none;
  return (
    <nav aria-label="Submissions in this list" className="flex items-center gap-2">
      <Step to={found.previous} direction="Previous" />
      <Step to={found.next} direction="Next" />
    </nav>
  );
}
