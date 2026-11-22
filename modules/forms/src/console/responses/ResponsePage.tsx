// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One response, as the server's staff projection returns it. Only the
// answers it holds are shown, labelled by the version the response pinned.
// Nothing here fills in, guesses or derives an answer the server left out.

import { call } from '@pixel-scientists/domain/api';
import { fileTypeLabels } from '@pixel-scientists/domain/files';
import { canSee, tableTotals, visibleFields } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  AnswerView,
  asProblem,
  Button,
  Dialog,
  NotFoundPage,
  PageHeader,
  RadioGroup,
  SummaryList,
  Tag,
  useLoad,
  useCan,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { AnswerHelpers } from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  getResponse,
  markResponseSpam,
  spamReasons,
  unmarkResponseSpam,
} from '../../contracts/index.ts';
import type { FormResponse, SpamReason } from '../../contracts/index.ts';
import { formatMoment } from '../format.ts';
import { FormsPage, orMissing, useParam } from '../Page.tsx';
import { FORMS_PATH, formPath, responsesPath } from '../paths.ts';
import { routeWords, spamWords } from '../words.ts';

const helpers: AnswerHelpers = { formatMoney, tableTotals, fileTypeLabels };

const loadResponse = (responseId: string) =>
  orMissing(call(getResponse, { params: { responseId } }));

const UNEXPECTED = 'Something went wrong. Try again.';

function SpamDialog({
  open,
  onClose,
  onMarked,
  responseId,
}: {
  open: boolean;
  onClose: () => void;
  onMarked: (reason: SpamReason) => void;
  responseId: string;
}) {
  const [reason, setReason] = useState<SpamReason | ''>('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  async function mark() {
    if (busy) return;
    setBusy(true);
    try {
      const marked = await call(markResponseSpam, {
        params: { responseId },
        // An empty choice is sent as it is: the contract refuses it in its own words.
        body: { reason },
      });
      if (marked.spamReason !== null) onMarked(marked.spamReason);
    } catch (error) {
      const found = asProblem(error);
      setProblem(found?.errors[0]?.message ?? found?.detail ?? UNEXPECTED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Mark this response as spam?"
      description="The response is kept. It stops showing in the received list, exports and reports, and you can undo this."
      actions={
        <>
          <Button data-autofocus onClick={onClose}>
            Keep as received
          </Button>
          <Button variant="primary" aria-disabled={busy || undefined} onClick={() => void mark()}>
            Mark as spam
          </Button>
        </>
      }
    >
      <RadioGroup
        legend="Why is it spam?"
        name="spam-reason"
        value={reason}
        onValueChange={(value) => {
          setReason(value as SpamReason);
        }}
        options={spamReasons.map((value) => ({ value, label: spamWords[value] }))}
        error={problem === '' ? undefined : problem}
      />
    </Dialog>
  );
}

function Response({ loaded }: { loaded: FormResponse }) {
  const [response, setResponse] = useState(loaded);
  const [asking, setAsking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState('');
  const canManage = useCan('forms.responses.manage');
  const { definition, answers } = response;
  const visible = visibleFields(definition, answers).filter((field) => canSee(field, 'staff'));

  async function undo() {
    setProblem('');
    try {
      const unmarked = await call(unmarkResponseSpam, { params: { responseId: response.id } });
      setResponse({ ...response, spamReason: unmarked.spamReason });
      setAnnouncement('The response is marked as not spam.');
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? UNEXPECTED);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Forms', to: FORMS_PATH },
          { label: 'Form', to: formPath(response.formId) },
          { label: 'Responses', to: responsesPath(response.formId) },
          { label: 'Response' },
        ]}
        title="Response"
        description={`Received ${formatMoment(response.submittedAt)}, on version ${String(response.version)} of the form.`}
        actions={
          canManage &&
          (response.spamReason === null ? (
            <Button
              onClick={() => {
                setAsking(true);
              }}
            >
              Mark as spam
            </Button>
          ) : (
            <Button onClick={() => void undo()}>Mark as not spam</Button>
          ))
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {problem !== '' && (
        <p role="alert" className="text-body text-danger">
          {problem}
        </p>
      )}
      <SummaryList
        items={[
          { term: 'How sent', value: routeWords[response.route] },
          {
            term: 'State',
            value:
              response.spamReason === null ? (
                <Tag tone={response.sentWithoutCheck ? 'warning' : 'neutral'}>
                  {response.sentWithoutCheck ? 'Sent without the browser check' : 'Received'}
                </Tag>
              ) : (
                <Tag tone="danger">{`Spam: ${spamWords[response.spamReason]}`}</Tag>
              ),
          },
        ]}
      />
      <AnswerView
        sections={definition.sections}
        visible={visible}
        answers={answers}
        helpers={helpers}
        noFiles="Files are not shown here"
        headingLevel="h2"
      />
      <SpamDialog
        open={asking}
        responseId={response.id}
        onClose={() => {
          setAsking(false);
        }}
        onMarked={(reason) => {
          setResponse({ ...response, spamReason: reason });
          setAsking(false);
          setAnnouncement('The response is marked as spam and kept.');
        }}
      />
    </>
  );
}

function Loader({ responseId }: { responseId: string }) {
  const { state, retry } = useLoad(loadResponse, responseId);
  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Response" />}
      <WhenLoaded state={state} label="Loading the response" retry={retry}>
        {(loaded) => (loaded === null ? <NotFoundPage /> : <Response loaded={loaded} />)}
      </WhenLoaded>
    </>
  );
}

export default function ResponsePage() {
  return (
    <FormsPage permission="forms.responses.read">
      <Loader responseId={useParam('responseId')} />
    </FormsPage>
  );
}
