// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A form anyone can answer, with no account (ADR 0036). It reads the form,
// keeps answers on this device only until they are sent, runs the browser
// check while the person answers, and sends once on their own action. It
// sets no cookie and sends none: every call is anonymous.

import { ProblemError } from '@pixel-scientists/domain/api';
import type { Answers } from '@pixel-scientists/domain/forms';
import { Button, Dialog, LoadingState, Notice, useParams } from '@pixel-scientists/ui';
import { useCallback, useState } from 'react';

import { getPublicForm, publicFormProblems, submitPublicResponse } from '../contracts/index.ts';
import type { PublicForm } from '../contracts/index.ts';
import { asBody, withAnswer } from './helpers.ts';
import { FormRunner } from './FormRunner.tsx';
import type { AnswerStore } from './FormRunner.tsx';
import { useFormsHost } from './host.tsx';
import { FormNotFound, LoadFailed } from './LoadFailed.tsx';
import { failureOf, retryKeyOf } from './problems.ts';
import { clearProgress, keepKnown, loadProgress, saveProgress } from './progress.ts';
import type { Restored } from './progress.ts';
import { usePublicProof } from './usePublicProof.ts';
import { useLoad } from './useLoad.ts';

const CHANGED =
  'This form changed while you were answering. Check that your answers are still right, then send them.';
const CHECKING = 'Checking your answers before sending. This can take a few seconds.';

/** 32 random bytes, 43 characters of base64url: the person's reference, made here and sent in the body only. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

interface Seed extends Restored {
  /** Said first on the review, when the form changed under the person. */
  reviewNote?: string;
}

function ClearAnswers({ onClear }: { onClear: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2 border-t border-divider pt-6">
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Clear my answers
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Clear your answers?"
        description="This removes everything you have typed from this device. You cannot undo it."
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep my answers
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setOpen(false);
                onClear();
              }}
            >
              Clear my answers
            </Button>
          </>
        }
      />
    </div>
  );
}

function Notices({ seed, embedded }: { seed: Seed; embedded: boolean }) {
  const where = embedded ? ' for this website only' : '';
  return (
    <div className="flex max-w-prose flex-col gap-4">
      <Notice
        tone="info"
        title={seed.available ? 'Your answers stay on this device' : 'Your answers are not kept'}
      >
        {seed.available
          ? `Your answers are saved on this device${where} until you send them. Nothing is sent to us before then. If you are using a shared computer, select Clear my answers when you finish.`
          : 'This browser does not let the page keep your answers. If you close the page, you will lose them.'}
      </Notice>
      {seed.restored && !seed.changed && (
        <p className="text-body text-ink">We found the answers you saved earlier.</p>
      )}
      {seed.changed && (
        <p className="text-body text-ink">
          This form has changed since you started. We kept your answers to questions that are still
          there.
        </p>
      )}
    </div>
  );
}

interface PublicFormProps {
  formId: string;
  form: PublicForm;
  /** What the person had when the form changed, if it did. */
  override: Seed | null;
  onFormChanged: (answers: Answers, available: boolean) => void;
  onClear: () => void;
}

function PublicForm({ formId, form, override, onFormChanged, onClear }: PublicFormProps) {
  const { call, slug, embedded } = useFormsHost();
  const [seed] = useState<Seed>(() => {
    if (override === null) return loadProgress(formId, form.formVersionId, form.definition);
    const { kept, dropped } = keepKnown(form.definition, override.answers);
    saveProgress(formId, form.formVersionId, kept);
    return { ...override, answers: kept, dropped };
  });
  const proof = usePublicProof(call, slug, formId);
  const [answers, setAnswers] = useState<Answers>(seed.answers);
  const [kept, setKept] = useState(seed.available);
  const [touched, setTouched] = useState(false);
  const [attempt, setAttempt] = useState<{ token: string; key?: string }>();
  const { formVersionId, definition } = form;

  const store: AnswerStore = {
    answers,
    change(fieldId, value) {
      const next = withAnswer(answers, fieldId, value);
      setAnswers(next);
      setTouched(true);
      setKept(saveProgress(formId, formVersionId, next));
    },
    status: (
      <p role="status" className="text-body text-muted">
        {touched &&
          (kept
            ? 'Saved on this device'
            : 'Not saved. If you close this page, you will lose your answers.')}
      </p>
    ),
    note: kept
      ? `Your answers are saved on this device${embedded ? ' for this website only' : ''}. Nothing is sent until you send them.`
      : 'Your answers are not being kept on this device.',
    unsaved: !kept && Object.keys(answers).length > 0,
    flush: () => Promise.resolve(true),
  };

  /** Sends once. A refused browser check is retried a single time with a new one. */
  async function submit(sendable: Answers) {
    let current = attempt ?? { token: newToken() };
    for (let retried = false; ; retried = true) {
      let checked;
      try {
        checked = await proof.take(form.noProofFallback);
      } catch {
        proof.renew();
        throw new ProblemError(400, publicFormProblems.proofInvalid.detail);
      }
      try {
        const receipt = await call(
          submitPublicResponse,
          {
            params: { slug, formId },
            body: {
              formVersionId,
              respondentToken: current.token,
              proof: checked,
              answers: asBody(sendable),
            },
          },
          {
            anonymous: true,
            ...(current.key === undefined ? {} : { idempotencyKey: current.key }),
          },
        );
        clearProgress(formId);
        setAttempt(undefined);
        setAnswers({});
        return { message: receipt.confirmationMessage, reference: current.token };
      } catch (error) {
        // A proof is used up by the first request that carries it, whatever the answer.
        proof.renew();
        const key = retryKeyOf(error);
        current = key === undefined ? { token: newToken() } : { token: current.token, key };
        setAttempt(current);
        if (!retried && error instanceof ProblemError && failureOf(error) === 'proof_invalid')
          continue;
        throw error;
      }
    }
  }

  return (
    <FormRunner
      title={form.title}
      description={form.description}
      definition={definition}
      store={store}
      notices={<Notices seed={seed} embedded={embedded} />}
      footer={<ClearAnswers onClear={onClear} />}
      submit={submit}
      onFormChanged={(answers) => {
        onFormChanged(answers, seed.available);
      }}
      waiting={proof.state === 'working'}
      waitingNote={CHECKING}
      {...(seed.reviewNote === undefined ? {} : { reviewNote: seed.reviewNote })}
    />
  );
}

/** The form, read again whenever the server says it changed. */
export default function PublicFormPage() {
  const { formId = '' } = useParams();
  const { call, slug } = useFormsHost();
  const [reads, setReads] = useState(0);
  const [resets, setResets] = useState(0);
  const [override, setOverride] = useState<Seed | null>(null);
  const read = useCallback(
    () =>
      call(getPublicForm, { params: { slug, formId } }, { anonymous: true }).catch(
        (error: unknown) => {
          // Closed, unpublished or switched off: whatever was kept is no use now.
          if (error instanceof ProblemError && error.status === 404) clearProgress(formId);
          throw error;
        },
      ),
    [call, slug, formId],
  );
  const { load, retry } = useLoad(read, `${slug}/${formId}/${String(reads)}`);

  if (load.status === 'loading') return <LoadingState label="Loading the form" />;
  if (load.status === 'failed') return <LoadFailed retry={retry} />;
  if (load.status === 'missing') return <FormNotFound />;
  const form = load.data;

  return (
    <PublicForm
      key={`${form.formVersionId}:${String(reads)}:${String(resets)}`}
      formId={formId}
      form={form}
      override={override}
      onFormChanged={(answers, available) => {
        clearProgress(formId);
        setOverride({
          answers,
          restored: true,
          changed: true,
          dropped: 0,
          available,
          reviewNote: CHANGED,
        });
        setReads((count) => count + 1);
      }}
      onClear={() => {
        clearProgress(formId);
        setOverride(null);
        setResets((count) => count + 1);
      }}
    />
  );
}
