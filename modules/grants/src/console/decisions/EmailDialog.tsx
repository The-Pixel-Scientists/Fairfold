// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, SummaryList, useLoad, WhenLoaded } from '@pixel-scientists/ui';

import { loadEmail } from './loaders.ts';

/** The email as the applicant will read it. A decision's email is plain text, so its line breaks are kept. */
export function EmailPreview({ submissionId }: { submissionId: string }) {
  const { state, retry } = useLoad(loadEmail, submissionId);
  return (
    <WhenLoaded state={state} label="Loading the email" retry={retry}>
      {({ subject, body }) => (
        <div className="flex flex-col gap-4">
          <SummaryList items={[{ term: 'Subject', value: subject }]} />
          <hr className="border-divider" />
          <div className="max-w-prose text-body whitespace-pre-wrap break-words text-ink">
            {body}
          </div>
        </div>
      )}
    </WhenLoaded>
  );
}

export interface EmailDialogProps {
  /** The submission whose email to show, or null when closed. */
  submission: { id: string; name: string } | null;
  onClose: () => void;
}

/** Shows the email a recorded decision will send. Nothing is sent until decisions are released. */
export function EmailDialog({ submission, onClose }: EmailDialogProps) {
  return (
    <Dialog
      open={submission !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Email for ${submission?.name ?? ''}`}
      wide
      description="This is the email the applicant gets when you release this decision. Nothing is sent now."
      actions={
        <Button variant="primary" data-autofocus onClick={onClose}>
          Close
        </Button>
      }
    >
      {submission && <EmailPreview submissionId={submission.id} />}
    </Dialog>
  );
}
