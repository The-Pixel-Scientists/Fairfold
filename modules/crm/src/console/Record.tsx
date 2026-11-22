// SPDX-License-Identifier: AGPL-3.0-or-later

import { LoadingState, Notice, useNavigate } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

/** Set when an address was a merged record, so the page it lands on can say so once. */
let followedMerge = false;

/** Goes to the record a merged one became, and remembers to say so. */
export function FollowMerge({ to }: { to: string }) {
  const navigate = useNavigate();
  const went = useRef(false);
  useEffect(() => {
    if (went.current) return;
    went.current = true;
    followedMerge = true;
    setTimeout(() => {
      navigate(to, { replace: true });
    }, 0);
  }, [navigate, to]);
  return <LoadingState label="Opening the merged record" />;
}

/** Says once that this record is where a merged one went. */
export function MergedNotice() {
  const [shown] = useState(() => {
    const was = followedMerge;
    followedMerge = false;
    return was;
  });
  return shown ? (
    <Notice tone="info" title="This record was merged">
      The address you opened was merged into this record. Its details and history are here.
    </Notice>
  ) : null;
}
