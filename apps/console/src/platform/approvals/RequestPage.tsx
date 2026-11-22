// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { idSchema } from '@pixel-scientists/domain';
import type { ApprovalRequestDetail } from '@pixel-scientists/domain/workflow';
import {
  ApprovalPanel,
  NotFoundPage,
  PageHeader,
  WhenLoaded,
  stepLabel,
  useCan,
  useLoad,
  useParams,
  useSession,
} from '@pixel-scientists/ui';
import type { Decision } from '@pixel-scientists/ui';
import { useState } from 'react';

import { useStepUp } from '../team/useStepUp.tsx';
import { NO_LONGER_AVAILABLE, isGone, loadRequest, readRequest, send } from './calls.ts';
import { APPROVALS_PATH } from './paths.ts';

function Request({ requestId }: { requestId: string }) {
  const { state, retry } = useLoad(loadRequest, requestId);
  const { state: session } = useSession();
  const stepUp = useStepUp();
  const [current, setCurrent] = useState<ApprovalRequestDetail | null>(null);
  const memberId = session.status === 'ready' ? (session.session.activeMembership?.id ?? '') : '';

  /** Makes the decision. After a refusal the page reads the request again, so it never shows a stale state. */
  async function decide(decision: Decision, key: string): Promise<boolean> {
    try {
      const updated = await stepUp.run(() => send(requestId, decision, key));
      if (updated === null) return false;
      setCurrent(updated);
      return true;
    } catch (error) {
      await readRequest(requestId).then(setCurrent, () => undefined);
      if (isGone(error)) throw new ProblemError(404, NO_LONGER_AVAILABLE);
      throw error;
    }
  }

  return (
    <>
      <PageHeader
        title="Approval request"
        breadcrumbs={[{ label: 'Approvals', to: APPROVALS_PATH }, { label: 'Request' }]}
      />
      <WhenLoaded state={state} label="Loading the request" retry={retry}>
        {({ request, zone }) => {
          const shown = current ?? request;
          return (
            <>
              <h2 className="text-lg font-semibold tracking-tight text-ink">{stepLabel(shown)}</h2>
              <ApprovalPanel
                request={shown}
                memberId={memberId}
                zone={zone}
                paused={stepUp.asking}
                onDecide={decide}
              />
              {stepUp.dialog}
            </>
          );
        }}
      </WhenLoaded>
    </>
  );
}

/** One approval request, with its history and the buttons this member may use. */
export default function RequestPage() {
  const allowed = useCan('platform.approvals.read');
  const id = idSchema.safeParse(useParams().requestId);
  return allowed && id.success ? (
    <div className="flex flex-col gap-stack">
      <Request requestId={id.data} />
    </div>
  ) : (
    <NotFoundPage />
  );
}
