// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  Checkbox,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  NotFoundPage,
  Notice,
  PageHeader,
  Panel,
  Select,
  Textarea,
  WhenLoaded,
  asProblem,
  useLeaveGuard,
  useLoad,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { answerKinds, MAX_CHECKLIST_ITEMS } from '../../contracts/index.ts';
import type { ChecklistVersion } from '../../contracts/index.ts';
import { Gate, useParam } from '../Gate.tsx';
import { loadChecklist, NOT_FOUND, saveChecklist } from '../loaders.ts';
import { CHECKLISTS_PATH } from '../paths.ts';
import { answerKindWords, formatMoment } from '../words.ts';
import { changes, empty, fromVersion, move, newItem, toInput, withKind } from './draft.ts';
import type { Draft, DraftItem } from './draft.ts';

/** Unsaved edits, kept while the member is in the console, so a route change does not lose them. */
const drafts = new Map<string, Draft>();

const NEW = 'new';
const KIND_WARNING =
  'Changing the answer kind makes this a new question. Earlier answers stay with the old one.';
const FROZEN = 'A published version cannot be edited. Change it by publishing a new version.';

async function readChecklist(id: string) {
  try {
    return id === NEW ? null : await loadChecklist(id);
  } catch (error) {
    if (asProblem(error)?.status === 404) return NOT_FOUND;
    throw error;
  }
}

interface ItemProps {
  item: DraftItem;
  index: number;
  count: number;
  renewed: boolean;
  onChange: (item: DraftItem) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  error: (field: string) => string | undefined;
}

function Item({ item, index, count, renewed, onChange, onMove, onRemove, error }: ItemProps) {
  const number = index + 1;
  const at = `items.${String(index)}`;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-divider p-3">
      <h3 className="font-semibold text-ink">{`Item ${String(number)}`}</h3>
      <FormField label="Check" id={`${at}.label`} error={error(`${at}.label`)}>
        <Input
          value={item.label}
          maxLength={200}
          onChange={(event) => {
            onChange({ ...item, label: event.target.value });
          }}
        />
      </FormField>
      <FormField label="Help text" id={`${at}.help`} optional error={error(`${at}.help`)}>
        <Textarea
          rows={2}
          value={item.help}
          maxLength={1000}
          onChange={(event) => {
            onChange({ ...item, help: event.target.value });
          }}
        />
      </FormField>
      <FormField label="Answer kind" id={`${at}.kind`} hint={renewed ? KIND_WARNING : undefined}>
        <Select
          value={item.kind}
          onChange={(event) => {
            const kind = answerKinds.find((value) => value === event.target.value);
            if (kind !== undefined) onChange(withKind(item, kind));
          }}
        >
          {answerKinds.map((kind) => (
            <option key={kind} value={kind}>
              {answerKindWords[kind]}
            </option>
          ))}
        </Select>
      </FormField>
      <Checkbox
        label="Answer required"
        checked={item.required}
        onCheckedChange={(required) => {
          onChange({ ...item, required });
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          id={`move-up-${item.id}`}
          disabled={index === 0}
          onClick={() => {
            onMove(index - 1);
          }}
        >
          {`Move item ${String(number)} up`}
        </Button>
        <Button
          id={`move-down-${item.id}`}
          disabled={index === count - 1}
          onClick={() => {
            onMove(index + 1);
          }}
        >
          {`Move item ${String(number)} down`}
        </Button>
        <Button disabled={count === 1} onClick={onRemove}>
          {`Remove item ${String(number)}`}
        </Button>
      </div>
    </li>
  );
}

interface EditorProps {
  checklistId: string | null;
  base: Draft;
  version: ChecklistVersion | null;
  onReload: () => void;
}

function Editor({ checklistId, base, version, onReload }: EditorProps) {
  const key = checklistId ?? NEW;
  const [draft, setDraftState] = useState<Draft>(() => drafts.get(key) ?? base);
  const [confirming, setConfirming] = useState(false);
  const [published, setPublished] = useState<ChecklistVersion | null>(null);
  const [said, setSaid] = useState('');
  const [renewed, setRenewed] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<string | null>(null);
  const retryKey = useRef<string | undefined>(undefined);
  const moved = useRef<string | null>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const dirty = published === null && JSON.stringify(draft) !== JSON.stringify(base);

  useLeaveGuard(dirty);

  function setDraft(next: Draft) {
    retryKey.current = undefined;
    drafts.set(key, next);
    setDraftState(next);
  }

  // Moving an item moves its buttons in the page, so focus goes back to the one just used.
  useEffect(() => {
    if (moved.current === null) return;
    const [direction = '', id = ''] = moved.current.split(':');
    const same = document.getElementById(`move-${direction}-${id}`);
    const other = document.getElementById(`move-${direction === 'up' ? 'down' : 'up'}-${id}`);
    (same instanceof HTMLButtonElement && !same.disabled ? same : other)?.focus();
    moved.current = null;
  }, [draft]);

  useEffect(() => {
    if (published !== null) confirmation.current?.focus();
  }, [published]);

  const fields = [
    'name',
    'description',
    ...draft.items.flatMap((_, index) => [
      `items.${String(index)}.label`,
      `items.${String(index)}.help`,
    ]),
  ];
  const form = useSubmit(fields, async () => {
    try {
      const saved = await saveChecklist(checklistId, toInput(draft), retryKey.current);
      drafts.delete(key);
      setConflict(null);
      setPublished(saved.version);
      setConfirming(false);
    } catch (error) {
      const problem = asProblem(error);
      const sent = (error as { idempotencyKey?: string | null }).idempotencyKey;
      retryKey.current = typeof sent === 'string' ? sent : undefined;
      setConfirming(false);
      if (problem?.status === 409) {
        setConflict(problem.detail);
        return;
      }
      throw error;
    }
  });

  const edits = changes(base, draft);
  const update = (index: number, item: DraftItem) => {
    setDraft({ ...draft, items: draft.items.map((old, at) => (at === index ? item : old)) });
  };
  const title = version === null ? 'Create checklist' : 'Publish new version';

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Checklists', to: CHECKLISTS_PATH },
          { label: checklistId === null ? 'New checklist' : 'Checklist' },
        ]}
        title={checklistId === null ? 'Create checklist' : 'Edit checklist'}
        description={
          version === null
            ? `Publishing creates version 1. ${FROZEN}`
            : `Version ${String(version.number)}, published ${formatMoment(version.publishedAt)}. ${FROZEN}`
        }
      />
      {published !== null && (
        <Notice tone="success" title="Checklist published">
          <h2 ref={confirmation} tabIndex={-1} className="font-semibold outline-offset-4">
            {`Version ${String(published.number)} published`}
          </h2>
          <p>Answers already saved stay on the version they answered.</p>
        </Notice>
      )}
      {conflict !== null && (
        <Notice
          tone="warning"
          title="The checklist has changed"
          action={<Button onClick={onReload}>Reload checklist</Button>}
        >
          {conflict}
        </Notice>
      )}
      <form
        noValidate
        className="flex flex-col gap-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirming(true);
        }}
      >
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <Panel title="Checklist">
          <FormField label="Name" id="name" error={form.errorFor('name')}>
            <Input
              value={draft.name}
              maxLength={120}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />
          </FormField>
          <FormField
            label="Description"
            id="description"
            optional
            error={form.errorFor('description')}
          >
            <Textarea
              rows={3}
              value={draft.description}
              maxLength={2000}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
              }}
            />
          </FormField>
        </Panel>
        <Panel title="Items">
          <ol className="flex flex-col gap-3">
            {draft.items.map((item, index) => (
              <Item
                key={item.id}
                item={item}
                index={index}
                count={draft.items.length}
                renewed={renewed.has(item.id)}
                error={form.errorFor}
                onChange={(next) => {
                  if (next.id !== item.id) setRenewed(new Set(renewed).add(next.id));
                  update(index, next);
                }}
                onMove={(to) => {
                  moved.current = `${to < index ? 'up' : 'down'}:${item.id}`;
                  setDraft({ ...draft, items: move(draft.items, index, to) });
                  setSaid(
                    `Item moved to position ${String(to + 1)} of ${String(draft.items.length)}.`,
                  );
                }}
                onRemove={() => {
                  setDraft({ ...draft, items: draft.items.filter((_, at) => at !== index) });
                  setSaid(`Item ${String(index + 1)} removed.`);
                }}
              />
            ))}
          </ol>
          <p role="status" className="sr-only">
            {said}
          </p>
          <div>
            <Button
              disabled={draft.items.length >= MAX_CHECKLIST_ITEMS}
              onClick={() => {
                setDraft({ ...draft, items: [...draft.items, newItem()] });
                setSaid(`Item ${String(draft.items.length + 1)} added.`);
              }}
            >
              Add item
            </Button>
          </div>
        </Panel>
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={published !== null || (version !== null && !dirty)}
          >
            {version === null ? 'Review and create' : 'Review and publish'}
          </Button>
        </div>
      </form>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={title}
        description={
          version === null
            ? 'This creates the checklist as version 1.'
            : `This publishes version ${String(version.number + 1)}. Version ${String(version.number)} and its answers are kept.`
        }
        actions={
          <>
            <Button
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep editing
            </Button>
            <Button
              type="submit"
              form="publish"
              variant="primary"
              aria-disabled={form.pending || undefined}
              data-autofocus
            >
              {title}
            </Button>
          </>
        }
      >
        <form id="publish" noValidate onSubmit={form.onSubmit}>
          {version === null ? (
            <p>{`The checklist has ${String(draft.items.length)} items.`}</p>
          ) : (
            <>
              <p className="font-medium">What changes</p>
              <ul className="list-disc pl-5">
                {edits.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </form>
      </Dialog>
    </>
  );
}

function Screen() {
  const id = useParam('checklistId') || NEW;
  const { state, retry } = useLoad(readChecklist, id);
  return (
    <WhenLoaded state={state} label="Loading the checklist" retry={retry}>
      {(loaded) => {
        if (loaded !== null && 'state' in loaded) return <NotFoundPage />;
        const version = loaded?.version ?? null;
        return (
          <Editor
            key={`${id}-${String(version?.number ?? 0)}`}
            checklistId={loaded?.id ?? null}
            base={version === null ? empty() : fromVersion(version)}
            version={version}
            onReload={() => {
              drafts.delete(id);
              retry();
            }}
          />
        );
      }}
    </WhenLoaded>
  );
}

export default function EditorPage() {
  return (
    <Gate permission="assure.checklists.manage">
      <Screen />
    </Gate>
  );
}
