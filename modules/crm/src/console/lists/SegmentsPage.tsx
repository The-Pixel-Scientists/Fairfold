// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Link,
  PageHeader,
  Panel,
  Select,
  Tag,
  Textarea,
  WhenLoaded,
  formText,
  useCan,
  useLoad,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { MAX_SEGMENT_FILTERS, segmentFields } from '../../contracts/index.ts';
import type { SegmentField, SegmentOperator } from '../../contracts/index.ts';
import { Needs } from '../Needs.tsx';
import { usePaged } from '../paged.ts';
import { PagedTable } from '../PagedTable.tsx';
import { segmentPath } from '../paths.ts';
import { loadLists, loadSegments, saveSegment } from './api.ts';
import { fieldLabels, filterFields, operatorLabels, valueChoices } from './words.ts';
import type { FilterField } from './words.ts';

/** One filter as the builder holds it. Its values live here and in the request, never in an address. */
interface Row {
  id: string;
  field: FilterField;
  operator: SegmentOperator;
  value: string;
}

const operatorsOf = (field: SegmentField) =>
  segmentFields[field].operators as readonly SegmentOperator[];

const newRow = (): Row => ({
  id: crypto.randomUUID(),
  field: 'kind',
  operator: 'eq',
  value: 'organisation',
});

const loadFirstLists = () => loadLists(null);

function Value({
  row,
  lists,
  onChange,
}: {
  row: Row;
  lists: readonly { id: string; name: string }[];
  onChange: (value: string) => void;
}) {
  const choices =
    row.field === 'list'
      ? lists.map(({ id, name }) => ({ value: id, label: name }))
      : valueChoices(row.field);
  return choices === null ? (
    <Input
      type="date"
      value={row.value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ) : (
    <Select
      value={row.value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="">Choose a value</option>
      {choices.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </Select>
  );
}

function Builder({ lists }: { lists: readonly { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const key = useRef(crypto.randomUUID());
  const navigate = useNavigate();

  const form = useSubmit(['name', 'description', 'filters'], async (data) => {
    const description = formText(data, 'description');
    const saved = await saveSegment(
      {
        name: formText(data, 'name'),
        ...(description === '' ? {} : { description }),
        filters: Object.fromEntries(
          rows.map(({ id, field, operator, value }) => [id, { field, operator, value }]),
        ),
      },
      key.current,
    );
    key.current = crypto.randomUUID();
    navigate(segmentPath(saved.id));
  });

  function change(id: string, next: Partial<Row>) {
    setRows((now) =>
      now.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...next };
        if (next.field !== undefined) {
          updated.operator = operatorsOf(next.field)[0] ?? 'eq';
          updated.value = '';
        }
        return updated;
      }),
    );
  }

  return (
    <Panel title="Build a segment">
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField label="Name" error={form.errorFor('name')} id="name" className="max-w-sm">
          <Input name="name" autoComplete="off" />
        </FormField>
        <FormField
          label="Description"
          hint="Optional."
          error={form.errorFor('description')}
          id="description"
          className="max-w-lg"
        >
          <Textarea name="description" rows={2} />
        </FormField>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-body font-medium text-ink">
            Records match when all of these are true
          </legend>
          {rows.map((row, index) => (
            <div key={row.id} className="flex flex-wrap items-end gap-3">
              <FormField label={`Field ${String(index + 1)}`}>
                <Select
                  value={row.field}
                  onChange={(event) => {
                    change(row.id, { field: event.target.value as FilterField });
                  }}
                >
                  {filterFields.map((field) => (
                    <option key={field} value={field}>
                      {fieldLabels[field]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={`Comparison ${String(index + 1)}`}>
                <Select
                  value={row.operator}
                  onChange={(event) => {
                    change(row.id, { operator: event.target.value as SegmentOperator });
                  }}
                >
                  {operatorsOf(row.field).map((operator) => (
                    <option key={operator} value={operator}>
                      {operatorLabels[operator]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={`Value ${String(index + 1)}`}>
                <Value
                  row={row}
                  lists={lists}
                  onChange={(value) => {
                    change(row.id, { value });
                  }}
                />
              </FormField>
              {rows.length > 1 && (
                <Button
                  onClick={() => {
                    setRows((now) => now.filter(({ id }) => id !== row.id));
                  }}
                >
                  {`Remove filter ${String(index + 1)}`}
                </Button>
              )}
            </div>
          ))}
          {form.errorFor('filters') !== undefined && (
            <p role="alert" className="text-body text-danger">
              {form.errorFor('filters')}
            </p>
          )}
          <div>
            <Button
              onClick={() => {
                setRows((now) => [...now, newRow()]);
              }}
              aria-disabled={rows.length >= MAX_SEGMENT_FILTERS || undefined}
            >
              Add filter
            </Button>
          </div>
        </fieldset>
        <p className="text-sm text-muted">
          Saving records the segment as a new version. Segments are for organising records: nothing
          is sent to a segment.
        </p>
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Save segment
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Reads the lists a filter can name, then shows the builder. */
function BuilderWithLists() {
  const lists = useLoad(loadFirstLists);
  return (
    <WhenLoaded state={lists.state} label="Loading the segment builder" retry={lists.retry}>
      {(page) => <Builder lists={page.items} />}
    </WhenLoaded>
  );
}

type Summary = Awaited<ReturnType<typeof loadSegments>>['items'][number];

function Segments() {
  const paged = usePaged(loadSegments, null);
  const canManage = useCan('crm.segments.manage');
  const columns: readonly Column<Summary>[] = [
    {
      key: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (segment) => <Link to={segmentPath(segment.id)}>{segment.name}</Link>,
    },
    { key: 'version', header: 'Version', align: 'end', cell: (segment) => String(segment.version) },
    {
      key: 'status',
      header: 'Status',
      cell: (segment) => (
        <Tag tone={segment.archivedAt === null ? 'success' : 'neutral'}>
          {segment.archivedAt === null ? 'In use' : 'Archived'}
        </Tag>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Segments"
        description="A segment is a saved filter. Its members are worked out each time you open it, so they stay current. Nothing is sent to a segment."
      />
      <PagedTable
        paged={paged}
        label="Loading segments"
        caption="Segments"
        columns={columns}
        rowKey={(segment) => segment.id}
        empty={
          <EmptyState title="No segments yet">
            <p>
              {canManage
                ? 'Build a segment below to save a filter you use often.'
                : 'Segments that staff save appear here.'}
            </p>
          </EmptyState>
        }
      />
      {canManage && <BuilderWithLists />}
    </div>
  );
}

/** The funder's saved segments, and a builder for members who manage them. */
export default function SegmentsPage() {
  return (
    <Needs permission="crm.records.read">
      <Segments />
    </Needs>
  );
}
