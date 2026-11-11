// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { Button, DateInput, Dialog, FormField, Input, Select } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { adjustmentMessages, adjustmentReasonSchema } from '../../../contracts/index.ts';
import type { Adjustment, AdjustmentKind } from '../../../contracts/index.ts';
import { UNEXPECTED } from '../../assessment/problems.ts';
import type { Moment } from '../../programme/roundDraft.ts';
import { giveAdjustment } from './loaders.ts';
import { closingOf, closingWords, reasonOptions, zoneWords } from './words.ts';

export interface GrantTarget {
  roundId: string;
  organisation: { id: string; name: string };
  /** An extension for one application only. */
  applicationId?: string;
  /** When it closes now, local to `timeZone`. */
  closesAt?: string;
  timeZone: string;
}

export interface GrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AdjustmentKind;
  target: GrantTarget;
  onGranted: (adjustment: Adjustment) => void;
}

interface Errors {
  closesAt?: string;
  reason?: string;
  other?: string;
}

const NO_TIME: Moment = { date: null, time: '' };

function GrantForm({
  kind,
  target,
  onClose,
  onGranted,
}: Omit<GrantDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [moment, setMoment] = useState(NO_TIME);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const retryKey = useRef<string | undefined>(undefined);
  const extension = kind === 'deadline_extension';

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const closesAt = closingOf(moment);
    const code = adjustmentReasonSchema.safeParse(reason);
    const missing = extension && closesAt === null;
    setErrors({
      ...(missing ? { closesAt: adjustmentMessages.closesAt } : {}),
      ...(code.success ? {} : { reason: adjustmentMessages.reason }),
    });
    if (!code.success || missing) return;
    const given = { organisationId: target.organisation.id, reasonCode: code.data };
    setPending(true);
    try {
      const adjustment = await giveAdjustment(
        target.roundId,
        closesAt === null || !extension
          ? { kind: 'alternative_route', ...given }
          : {
              kind: 'deadline_extension',
              ...given,
              closesAt,
              ...(target.applicationId === undefined
                ? {}
                : { applicationId: target.applicationId }),
            },
        retryKey.current,
      );
      onGranted(adjustment);
    } catch (error) {
      if (!(error instanceof ProblemError)) {
        setErrors({ other: UNEXPECTED });
      } else {
        // A lost answer is tried again under the same key, so it cannot give twice.
        const lost = error.status === 0 || error.status >= 500;
        retryKey.current = lost ? (error.idempotencyKey ?? undefined) : undefined;
        const at = error.errors.find(({ field }) => field === 'body.closesAt');
        setErrors(at ? { closesAt: at.message } : { other: error.detail });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      {errors.other && (
        <p role="alert" className="font-medium text-danger">
          {errors.other}
        </p>
      )}
      {extension && (
        <>
          {target.closesAt !== undefined && (
            <p className="text-body text-ink">
              It closes {closingWords(target.closesAt, target.timeZone)} now.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
            <DateInput
              id="closesAt"
              legend="New closing date"
              value={moment.date}
              error={errors.closesAt}
              onChange={(date) => {
                setMoment((was) => ({ ...was, date }));
              }}
            />
            <FormField id="closesAtTime" label="New closing time" hint={zoneWords(target.timeZone)}>
              <Input
                type="time"
                value={moment.time}
                className="w-40"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setMoment((was) => ({ ...was, time: value }));
                }}
              />
            </FormField>
          </div>
        </>
      )}
      <FormField
        id="reasonCode"
        label="Reason"
        hint="Staff see the reason. The applicant does not."
        error={errors.reason}
      >
        <Select
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
          }}
        >
          <option value="">Choose a reason</option>
          {reasonOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
          {extension ? 'Give more time' : 'Allow staff to submit'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Gives an organisation more time, or the alternative route, in a round. The
 * reason is chosen from a fixed list and never typed. The closing time is on
 * the wall clock of the round's zone, which is how the API reads it too.
 */
export function GrantDialog({ open, onOpenChange, kind, target, onGranted }: GrantDialogProps) {
  const extension = kind === 'deadline_extension';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={extension ? 'Give more time' : 'Let staff submit for the applicant'}
      description={
        extension
          ? `Choose a new closing time for ${target.organisation.name}. The applicant sees only their new closing time, not the reason.`
          : `Staff will be able to fill in and submit the application for ${target.organisation.name}. The applicant is told when it is submitted, and does not see the reason.`
      }
    >
      <GrantForm
        kind={kind}
        target={target}
        onGranted={onGranted}
        onClose={() => {
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}
