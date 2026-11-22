// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  DataTable,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Notice,
  PageHeader,
  Panel,
  asProblem,
  formText,
  useCan,
  useSubmit,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { MAX_MEMBERS_PER_CHANGE } from '../../contracts/index.ts';
import type { PartySearchPage } from '../../contracts/index.ts';
import { useParam } from '../Gate.tsx';
import { PartyLink } from '../labels.tsx';
import { search } from '../loaders.ts';
import { Needs } from '../Needs.tsx';
import { usePaged } from '../paged.ts';
import { PagedTable } from '../PagedTable.tsx';
import { LISTS_PATH } from '../paths.ts';
import { kindWords } from '../words.ts';
import { add, loadMembers, remove } from './api.ts';

type Member = Awaited<ReturnType<typeof loadMembers>>['items'][number];
type Found = PartySearchPage['results'][number];

const capWords = `Add up to ${String(MAX_MEMBERS_PER_CHANGE)} records at a time. Choose fewer records, then add them.`;

function Finder({ listId, onAdded }: { listId: string; onAdded: () => void }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const key = useRef(crypto.randomUUID());
  const adding = useRef(false);

  const form = useSubmit(['term'], async (data) => {
    const page = await search({ term: formText(data, 'term') });
    setFound(page.results.filter((row) => row.status === 'active'));
    setPicked(new Set());
    setProblem(null);
  });

  async function addPicked() {
    if (adding.current) return;
    if (picked.size > MAX_MEMBERS_PER_CHANGE) {
      setProblem(capWords);
      return;
    }
    adding.current = true;
    try {
      const result = await add(listId, [...picked], key.current);
      key.current = crypto.randomUUID();
      setPicked(new Set());
      setProblem(null);
      setSaid(
        `Added ${String(result.changed)} to the list${result.unchanged > 0 ? `, ${String(result.unchanged)} already on it` : ''}.`,
      );
      onAdded();
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
    } finally {
      adding.current = false;
    }
  }

  const columns: readonly Column<Found>[] = [
    { key: 'name', header: 'Name', rowHeader: true, cell: (row) => row.label },
    { key: 'kind', header: 'Kind', cell: (row) => kindWords[row.kind] },
  ];

  return (
    <Panel title="Add records to this list">
      <div className="flex flex-col gap-3">
        <form
          role="search"
          aria-label="Search records to add"
          noValidate
          onSubmit={form.onSubmit}
          className="flex flex-wrap items-end gap-3"
        >
          <ErrorSummary key={form.attempt} errors={form.errors} />
          <FormField
            label="Search"
            hint="A name, an email address or a charity or company number."
            error={form.errorFor('term')}
            id="term"
            className="w-full max-w-sm"
          >
            <Input name="term" type="search" autoComplete="off" />
          </FormField>
          <Button type="submit" aria-disabled={form.pending || undefined}>
            Search records
          </Button>
        </form>
        {found !== null && (
          <DataTable
            caption="Records found"
            columns={columns}
            rows={found}
            rowKey={(row) => row.id}
            selection={{
              selected: picked,
              onSelectedChange: setPicked,
              label: (row) => `Select ${row.label}`,
            }}
            empty={
              <p className="text-muted">
                No records match. Check the spelling or search by number.
              </p>
            }
          />
        )}
        {problem !== null && (
          <p role="alert" className="text-body font-medium text-danger">
            {problem}
          </p>
        )}
        <p role="status" className="text-sm text-muted">
          {said}
        </p>
        {found !== null && found.length > 0 && (
          <div>
            <Button
              variant="primary"
              onClick={() => void addPicked()}
              aria-disabled={picked.size === 0 || undefined}
            >
              {`Add ${String(picked.size)} to list`}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Members() {
  const listId = useParam('listId');
  const paged = usePaged(loadMembers, listId);
  const canManage = useCan('crm.lists.manage');
  const [problem, setProblem] = useState<string | null>(null);
  const removing = useRef(false);

  async function take(member: Member) {
    if (removing.current) return;
    removing.current = true;
    try {
      await remove(listId, [member.partyId], crypto.randomUUID());
      paged.remove((row) => row.partyId === member.partyId);
      setProblem(null);
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
    } finally {
      removing.current = false;
    }
  }

  const columns: readonly Column<Member>[] = [
    {
      key: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (member) => <PartyLink kind={member.kind} id={member.partyId} />,
    },
    { key: 'kind', header: 'Kind', cell: (member) => kindWords[member.kind] },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            cell: (member: Member) => (
              <Button
                onClick={() => {
                  void take(member);
                }}
              >
                Remove from list
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="List members"
        description="Lists are for organising records. Nothing is sent to a list, and removing a record from a list does not change the record."
        breadcrumbs={[{ label: 'Lists', to: LISTS_PATH }, { label: 'List members' }]}
      />
      {problem !== null && (
        <div role="alert">
          <Notice tone="danger" title="The record was not removed">
            {problem}
          </Notice>
        </div>
      )}
      <PagedTable
        paged={paged}
        label="Loading members"
        caption="Members of this list"
        columns={columns}
        rowKey={(member) => member.partyId}
        empty={
          <EmptyState title="This list has no members">
            <p>
              {canManage
                ? 'Search for records below, then add them.'
                : 'Members that staff add appear here.'}
            </p>
          </EmptyState>
        }
      />
      {canManage && <Finder listId={listId} onAdded={paged.retry} />}
    </div>
  );
}

/** One list's members, with adding and removing for members who manage lists. */
export default function ListPage() {
  return (
    <Needs permission="crm.records.read">
      <Members />
    </Needs>
  );
}
