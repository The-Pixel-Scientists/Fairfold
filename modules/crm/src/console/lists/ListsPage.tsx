// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  Dialog,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Link,
  PageHeader,
  Tag,
  Textarea,
  formText,
  useCan,
  useSubmit,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import type { List } from '../../contracts/index.ts';
import { Needs } from '../Needs.tsx';
import { usePaged } from '../paged.ts';
import { PagedTable } from '../PagedTable.tsx';
import { listPath } from '../paths.ts';
import { archive, loadLists, makeList, renameList } from './api.ts';

type Editing =
  { kind: 'create' } | { kind: 'rename'; list: List } | { kind: 'archive'; list: List };

function NameDialog({
  editing,
  onClose,
  onDone,
}: {
  editing: Extract<Editing, { kind: 'create' | 'rename' }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = editing.kind === 'create';
  const key = useRef(crypto.randomUUID());
  const form = useSubmit(['name', 'description'], async (data) => {
    const name = formText(data, 'name');
    if (create) await makeList(name, formText(data, 'description'), key.current);
    else await renameList(editing.list.id, name);
    onDone();
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={create ? 'Create list' : 'Rename list'}
      description="Lists are for organising records. Nothing is sent to a list."
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="list-form"
            variant="primary"
            aria-disabled={form.pending || undefined}
          >
            {create ? 'Create list' : 'Rename list'}
          </Button>
        </>
      }
    >
      <form id="list-form" noValidate onSubmit={form.onSubmit} className="flex flex-col gap-3">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField label="Name" error={form.errorFor('name')} id="name">
          <Input
            name="name"
            autoComplete="off"
            defaultValue={create ? '' : editing.list.name}
            data-autofocus
          />
        </FormField>
        {create && (
          <FormField
            label="Description"
            hint="Optional."
            error={form.errorFor('description')}
            id="description"
          >
            <Textarea name="description" rows={3} />
          </FormField>
        )}
      </form>
    </Dialog>
  );
}

function ArchiveDialog({
  list,
  onClose,
  onDone,
}: {
  list: List;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useSubmit([], async () => {
    await archive(list.id);
    onDone();
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Archive list"
      description="The members are kept, and nothing is sent. The list moves to the end of the lists."
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="archive-form"
            variant="primary"
            aria-disabled={form.pending || undefined}
          >
            Archive list
          </Button>
        </>
      }
    >
      <form id="archive-form" noValidate onSubmit={form.onSubmit}>
        <ErrorSummary key={form.attempt} errors={form.errors} />
      </form>
    </Dialog>
  );
}

function Lists() {
  const paged = usePaged(loadLists, null);
  const canManage = useCan('crm.lists.manage');
  const [editing, setEditing] = useState<Editing | null>(null);

  const columns: readonly Column<List>[] = [
    {
      key: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (list) => <Link to={listPath(list.id)}>{list.name}</Link>,
    },
    { key: 'members', header: 'Members', align: 'end', cell: (list) => String(list.members) },
    {
      key: 'status',
      header: 'Status',
      cell: (list) => (
        <Tag tone={list.archivedAt === null ? 'success' : 'neutral'}>
          {list.archivedAt === null ? 'In use' : 'Archived'}
        </Tag>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            cell: (list: List) =>
              list.archivedAt === null ? (
                <span className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setEditing({ kind: 'rename', list });
                    }}
                  >
                    Rename list
                  </Button>
                  <Button
                    onClick={() => {
                      setEditing({ kind: 'archive', list });
                    }}
                  >
                    Archive list
                  </Button>
                </span>
              ) : null,
          },
        ]
      : []),
  ];

  const close = () => {
    setEditing(null);
  };
  const done = () => {
    setEditing(null);
    paged.retry();
  };

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Lists"
        description="Lists are for organising records, such as the organisations in a cohort. Nothing is sent to a list."
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing({ kind: 'create' });
              }}
            >
              Create list
            </Button>
          ) : undefined
        }
      />
      <PagedTable
        paged={paged}
        label="Loading lists"
        caption="Lists"
        columns={columns}
        rowKey={(list) => list.id}
        empty={
          <EmptyState title="No lists yet">
            <p>
              {canManage
                ? 'Create a list, then add organisations and people to it.'
                : 'Lists that staff create appear here.'}
            </p>
          </EmptyState>
        }
      />
      {editing?.kind === 'archive' && (
        <ArchiveDialog list={editing.list} onClose={close} onDone={done} />
      )}
      {(editing?.kind === 'create' || editing?.kind === 'rename') && (
        <NameDialog editing={editing} onClose={close} onDone={done} />
      )}
    </div>
  );
}

/** The funder's lists with their member counts. */
export default function ListsPage() {
  return (
    <Needs permission="crm.records.read">
      <Lists />
    </Needs>
  );
}
