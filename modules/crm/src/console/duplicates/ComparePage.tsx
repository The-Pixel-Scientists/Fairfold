// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import type { PartyKind } from '@pixel-scientists/party/contracts';
import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Link,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  RadioGroup,
  asProblem,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  confirmMerge,
  crmMessages,
  mergeConflictMessages,
  previewMerge,
} from '../../contracts/index.ts';
import type { MergePreview, MergeRecord } from '../../contracts/index.ts';
import { PartyLink, usePartyName } from '../labels.tsx';
import { Needs } from '../Needs.tsx';
import { Outcome } from '../Outcome.tsx';
import { useParam } from '../Gate.tsx';
import { DUPLICATES_PATH, organisationPath, personPath } from '../paths.ts';
import { useStepUp } from '../useStepUp.tsx';
import { fieldWords } from '../words.ts';
import { movesWords } from './words.ts';

type Field = MergePreview['fields'][number];

type Preview =
  | { status: 'loading' }
  | { status: 'declined' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; preview: MergePreview };

const UNEXPECTED = 'Something went wrong. Try again.';
const STALE = 'The records changed after you compared them. Compare the records again, then merge.';

const noun = (kind: PartyKind) => (kind === 'organisation' ? 'organisations' : 'people');

function Contact({
  personId,
  checked,
  onChange,
}: {
  personId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const name = usePartyName('person', personId) ?? 'Loading name';
  return <Checkbox label={name} checked={checked} onCheckedChange={onChange} />;
}

const NO_LINKS: ReadonlySet<string> = new Set();

const show = (value: string | null) => value ?? <span className="text-muted">Empty</span>;

/** The two records side by side, from the server's preview. Opening it changes nothing. */
function Compare({ kind, first, second }: { kind: PartyKind; first: string; second: string }) {
  const [survivorId, setSurvivorId] = useState(first);
  const loserId = survivorId === first ? second : first;
  const step = useStepUp();
  const [attempt, setAttempt] = useState(0);
  const want = `${loserId}:${survivorId}:${String(attempt)}`;
  const [read, setRead] = useState<{ for: string; value: Preview } | null>(null);
  const [chosen, setChosen] = useState<{ for: string; links: ReadonlySet<string> } | null>(null);
  const state: Preview = read?.for === want ? read.value : { status: 'loading' };
  const carry = chosen?.for === want ? chosen.links : NO_LINKS;
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [merged, setMerged] = useState<MergeRecord | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const key = useRef(crypto.randomUUID());
  const { run } = step;
  const survivorName = usePartyName(kind, survivorId);
  const loserName = usePartyName(kind, loserId);

  useEffect(() => {
    let current = true;
    key.current = crypto.randomUUID();
    const answer = (value: Preview) => {
      if (current) setRead({ for: want, value });
    };
    run(() => call(previewMerge, { body: { loserId, survivorId, kind } })).then(
      (preview) => {
        answer(preview === null ? { status: 'declined' } : { status: 'ready', preview });
      },
      (error: unknown) => {
        answer({ status: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
      },
    );
    return () => {
      current = false;
    };
  }, [run, loserId, survivorId, kind, want]);

  const reload = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  async function merge(preview: MergePreview) {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    try {
      const record = await run(() =>
        call(
          confirmMerge,
          {
            body: {
              loserId: preview.loserId,
              survivorId: preview.survivorId,
              kind: preview.kind,
              carryOver: preview.linkRule === 'choose' ? [...carry] : [],
              token: preview.token,
            },
          },
          { idempotencyKey: key.current },
        ),
      );
      if (record !== null) setMerged(record);
    } catch (error) {
      const failure = asProblem(error);
      setAsking(false);
      setProblem(
        failure?.detail === crmMessages.previewToken ? STALE : (failure?.detail ?? UNEXPECTED),
      );
      if (failure?.status === 409) reload();
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  if (merged !== null) {
    return (
      <Outcome title="The records are merged">
        <p>
          The merge record is {merged.id}. Open{' '}
          <Link
            to={
              kind === 'organisation'
                ? organisationPath(merged.survivorId)
                : personPath(merged.survivorId)
            }
          >
            the record you kept
          </Link>
          .
        </p>
      </Outcome>
    );
  }

  const columns: readonly Column<Field>[] = [
    { key: 'field', header: 'Field', rowHeader: true, cell: (row) => fieldWords[row.fieldId] },
    {
      key: 'survivor',
      header: `Keep: ${survivorName ?? 'first record'}`,
      cell: (row) => show(row.survivor),
    },
    {
      key: 'loser',
      header: `Merge away: ${loserName ?? 'second record'}`,
      cell: (row) => show(row.loser),
    },
    {
      key: 'difference',
      header: 'Difference',
      cell: (row) => (row.loser === row.survivor ? 'Same' : 'Different'),
    },
  ];

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Compare records"
        description="The record you keep stays as it is. The other record is marked as merged, and what points to it moves to the record you keep."
        breadcrumbs={[
          { label: 'Possible duplicates', to: DUPLICATES_PATH },
          { label: 'Compare records' },
        ]}
      />
      <RadioGroup
        legend="Which record do you keep?"
        name="survivor"
        value={survivorId}
        onValueChange={setSurvivorId}
        options={[first, second].map((id) => ({
          value: id,
          label: <PartyLink kind={kind} id={id} />,
        }))}
      />
      {problem !== null && (
        <div role="alert">
          <Notice tone="danger" title="The records were not merged">
            {problem}
          </Notice>
        </div>
      )}
      {state.status === 'loading' && <LoadingState label="Comparing the records" />}
      {state.status === 'declined' && (
        <EmptyState
          title="Confirm it is you to compare records"
          action={<Button onClick={reload}>Compare records</Button>}
        >
          <p>Comparing records needs a recent sign-in.</p>
        </EmptyState>
      )}
      {state.status === 'failed' && (
        <EmptyState
          title="We could not compare these records"
          action={<Button onClick={reload}>Try again</Button>}
        >
          <p>{state.message}</p>
        </EmptyState>
      )}
      {state.status === 'ready' && (
        <Ready
          preview={state.preview}
          columns={columns}
          carry={carry}
          onCarry={(links) => {
            setChosen({ for: want, links });
          }}
          onMerge={() => {
            setAsking(true);
          }}
        />
      )}
      {state.status === 'ready' && (
        <Dialog
          open={asking && !step.asking}
          onOpenChange={(open) => {
            if (!open && !pending) setAsking(false);
          }}
          title={kind === 'organisation' ? 'Merge organisations' : 'Merge people'}
          description={
            <Moves
              preview={state.preview}
              survivor={survivorName ?? 'the record you keep'}
              loser={loserName ?? 'the other record'}
            />
          }
          actions={
            <>
              <Button
                onClick={() => {
                  setAsking(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                data-autofocus
                aria-disabled={pending || undefined}
                onClick={() => void merge(state.preview)}
              >
                {`Merge ${noun(kind)}`}
              </Button>
            </>
          }
        />
      )}
      {step.dialog}
    </div>
  );
}

function Moves({
  preview,
  survivor,
  loser,
}: {
  preview: MergePreview;
  survivor: string;
  loser: string;
}) {
  const words = movesWords(preview.counts);
  const links = preview.linkRule === 'choose' ? preview.links.length : 0;
  return (
    <span className="flex flex-col gap-2">
      <span>
        {words === null
          ? 'No records in other tools move. '
          : `${words} will move to ${survivor}. `}
        {`${loser} will be marked as merged.`}
      </span>
      {links > 0 && <span>Contact links you choose stay with {survivor}.</span>}
    </span>
  );
}

function Ready({
  preview,
  columns,
  carry,
  onCarry,
  onMerge,
}: {
  preview: MergePreview;
  columns: readonly Column<Field>[];
  carry: ReadonlySet<string>;
  onCarry: (next: ReadonlySet<string>) => void;
  onMerge: () => void;
}) {
  const blocked = preview.conflicts.length > 0;
  return (
    <div className="flex flex-col gap-stack">
      {blocked && (
        <Notice tone="danger" title="These records cannot be merged yet">
          <ul className="list-disc pl-5">
            {preview.conflicts.map((conflict) => (
              <li key={conflict}>{mergeConflictMessages[conflict]}</li>
            ))}
          </ul>
        </Notice>
      )}
      <DataTable
        caption="Fields of the two records"
        columns={columns}
        rows={preview.fields}
        rowKey={(row) => row.fieldId}
        empty={<p className="text-muted">The records have no details to compare.</p>}
      />
      <Panel title="Contact links">
        {preview.linkRule === 'choose' && preview.links.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body text-muted">
              Choose the contact links to carry over to the record you keep.
            </legend>
            {preview.links.map((link) => (
              <Contact
                key={link.relationshipId}
                personId={link.personId}
                checked={carry.has(link.relationshipId)}
                onChange={(checked) => {
                  const next = new Set(carry);
                  if (checked) next.add(link.relationshipId);
                  else next.delete(link.relationshipId);
                  onCarry(next);
                }}
              />
            ))}
          </fieldset>
        ) : (
          <p className="text-body text-muted">
            {preview.linkRule === 'automatic'
              ? 'Contact links move to the record you keep without a choice.'
              : preview.linkRule === 'none'
                ? 'No contact links move, because the record you keep has an account.'
                : 'The other record has no contact links.'}
          </p>
        )}
      </Panel>
      {!blocked && (
        <div>
          <Button variant="primary" onClick={onMerge}>
            {preview.kind === 'organisation'
              ? 'Review merge of organisations'
              : 'Review merge of people'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The page for two records that may be one. The kind and ids come from the address. */
export default function ComparePage() {
  return (
    <Needs permission="crm.parties.merge">
      <Address />
    </Needs>
  );
}

function Address() {
  const kind = useParam('kind') as PartyKind;
  return <Compare kind={kind} first={useParam('partyId')} second={useParam('otherPartyId')} />;
}
