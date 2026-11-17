// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tenant's label set: create, rename, recolour and archive. There is no
// delete; an archived label stays on the submissions that have it and cannot
// be added again. The server decides what a duplicate name is and never
// echoes the name back.

import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  PageHeader,
  Select,
  useLoad,
  useSubmit,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { labelColours, labelColourSchema } from '../../../contracts/index.ts';
import type { Label, LabelColour } from '../../../contracts/index.ts';
import { ManagePage } from '../../programme/Page.tsx';
import { problemLines } from '../../assessment/problems.ts';
import { archiveOne, addLabel, editLabel, loadLabels } from './loaders.ts';
import { colourWords, LabelChip } from './LabelChip.tsx';

const FIELDS = ['name', 'colour'];

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name, 'en-GB');

interface LabelFormProps {
  initial?: Label;
  save: string;
  onSave: (name: string, colour: LabelColour) => Promise<void>;
}

function LabelForm({ initial, save, onSave }: LabelFormProps) {
  const form = useSubmit(FIELDS, async (data) => {
    const name = data.get('name');
    await onSave(typeof name === 'string' ? name : '', labelColourSchema.parse(data.get('colour')));
  });
  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField id="name" label="Name" error={form.errorFor('name')}>
        <Input name="name" defaultValue={initial?.name ?? ''} autoComplete="off" />
      </FormField>
      <FormField id="colour" label="Colour" hint="The name always shows; the colour only helps.">
        <Select name="colour" defaultValue={initial?.colour ?? 'neutral'}>
          {labelColours.map((colour) => (
            <option key={colour} value={colour}>
              {colourWords[colour]}
            </option>
          ))}
        </Select>
      </FormField>
      <div>
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          {save}
        </Button>
      </div>
    </form>
  );
}

type Action = { kind: 'edit' | 'archive'; label: Label };

function Manager({ initial }: { initial: readonly Label[] }) {
  const [labels, setLabels] = useState(initial);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState({ text: '', count: 0 });
  const status = useRef<HTMLParagraphElement>(null);
  const [failure, setFailure] = useState<string[]>([]);
  const announce = (text: string) => {
    setNotice((current) => ({ text, count: current.count + 1 }));
  };
  // Creating remounts the form and archiving removes the button that opened the
  // dialog, so the result takes focus, as it does on the submissions list.
  useEffect(() => {
    if (notice.count > 0) status.current?.focus();
  }, [notice.count]);
  const put = (label: Label) => {
    setLabels((current) => [...current.filter(({ id }) => id !== label.id), label].sort(byName));
  };
  const close = () => {
    setAction(null);
    setFailure([]);
  };

  async function archive(label: Label) {
    try {
      put(await archiveOne(label.id));
      announce('Label archived.');
      close();
    } catch (error) {
      setFailure(problemLines(error));
    }
  }

  const columns: readonly Column<Label>[] = [
    {
      key: 'label',
      header: 'Label',
      rowHeader: true,
      cell: (label) => <LabelChip label={label} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (label) =>
        label.archived ? null : (
          <span className="flex justify-end gap-2">
            <Button
              aria-label={`Edit ${label.name}`}
              onClick={() => {
                setAction({ kind: 'edit', label });
              }}
            >
              Edit
            </Button>
            <Button
              aria-label={`Archive ${label.name}`}
              onClick={() => {
                setAction({ kind: 'archive', label });
              }}
            >
              Archive
            </Button>
          </span>
        ),
    },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <section aria-labelledby="new-label" className="flex flex-col gap-3">
        <h2 id="new-label" className="text-lg font-semibold tracking-tight text-ink">
          New label
        </h2>
        <LabelForm
          key={labels.length}
          save="Create label"
          onSave={async (name, colour) => {
            put(await addLabel(name, colour));
            announce('Label created.');
          }}
        />
      </section>
      <p ref={status} role="status" tabIndex={-1} className="text-body text-ink empty:hidden">
        {notice.text}
      </p>
      <DataTable
        caption="Labels"
        columns={columns}
        rows={labels}
        rowKey={(label) => label.id}
        empty={
          <EmptyState title="No labels yet" headingLevel="h3">
            <p>Create a label above. Staff can then add it to submissions.</p>
          </EmptyState>
        }
      />
      <Dialog
        open={action?.kind === 'edit'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title="Edit label"
        description="Renaming a label changes it on every submission that has it."
      >
        {action?.kind === 'edit' && (
          <LabelForm
            initial={action.label}
            save="Save label"
            onSave={async (name, colour) => {
              put(await editLabel(action.label.id, name, colour));
              announce('Label saved.');
              close();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={action?.kind === 'archive'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title="Archive label"
        description="The label stays on the submissions that have it. Nobody can add it again."
      >
        {action?.kind === 'archive' && (
          <div className="flex flex-col gap-4">
            {failure.length > 0 && (
              <p role="alert" className="font-medium text-danger">
                {failure.join(' ')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button data-autofocus onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void archive(action.label);
                }}
              >
                Archive {action.label.name}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Loaded() {
  const { state, retry } = useLoad(loadLabels);
  return (
    <WhenLoaded state={state} label="Loading labels" retry={retry}>
      {({ labels }) => <Manager initial={labels} />}
    </WhenLoaded>
  );
}

/** Labels staff add to submissions to sort and find them. */
export default function LabelsPage() {
  return (
    <ManagePage title="Labels">
      <PageHeader
        title="Labels"
        description="Labels sort submissions your way. They never change a stage, a status or a decision."
      />
      <Loaded />
    </ManagePage>
  );
}
