// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  DataTable,
  EmptyState,
  FormField,
  Link,
  LoadingState,
  PageHeader,
  Select,
  Tag,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { listForms } from '../../contracts/index.ts';
import type { Form } from '../../contracts/index.ts';
import { formatMoment } from '../format.ts';
import { FormsPage, LinkButton } from '../Page.tsx';
import { usePages, useRemembered } from '../pages.ts';
import { ShowMore } from '../ShowMore.tsx';
import { formPath, NEW_FORM_PATH, TEMPLATES_PATH } from '../paths.ts';
import { respondentWords, statusWords } from '../words.ts';

type Row = Awaited<ReturnType<typeof readForms>>['items'][number];

type Filter = '' | Form['status'];

async function readForms(status: Filter, cursor: string | null) {
  const { forms, nextCursor } = await call(listForms, {
    query: {
      ...(status === '' ? {} : { status }),
      ...(cursor === null ? {} : { cursor }),
    },
  });
  return { items: forms, next: nextCursor };
}

const none = (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">None</span>
  </>
);

const columns: readonly Column<Row>[] = [
  {
    key: 'title',
    header: 'Form',
    rowHeader: true,
    cell: (row) => (
      <span className="block min-w-48 max-w-96 whitespace-normal">
        <Link to={formPath(row.id)}>{row.title}</Link>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <Tag tone={row.status === 'published' ? 'success' : 'neutral'}>{statusWords[row.status]}</Tag>
    ),
  },
  { key: 'who', header: 'Who can answer', cell: (row) => respondentWords[row.respondents] },
  {
    key: 'opens',
    header: 'Opens',
    cell: (row) => (row.opensAt === null ? none : formatMoment(row.opensAt)),
  },
  {
    key: 'closes',
    header: 'Closes',
    cell: (row) => (row.closesAt === null ? none : formatMoment(row.closesAt)),
  },
  {
    key: 'version',
    header: 'Latest version',
    align: 'end',
    cell: (row) => (row.latestVersion === null ? none : String(row.latestVersion)),
  },
];

const create = (
  <>
    <LinkButton to={NEW_FORM_PATH} variant="primary">
      Create form
    </LinkButton>
    <LinkButton to={TEMPLATES_PATH}>Start from a template</LinkButton>
  </>
);

function FormsTable({ status }: { status: Filter }) {
  const { state, retry, more } = usePages(`forms:${status}`, (cursor) => readForms(status, cursor));

  if (state.status === 'loading') return <LoadingState label="Loading forms" />;
  if (state.status === 'failed') {
    return (
      <EmptyState
        title="We could not load the forms"
        action={<Button onClick={retry}>Try again</Button>}
      >
        <p>{state.message}</p>
      </EmptyState>
    );
  }
  if (state.items.length === 0) {
    return status === '' ? (
      <EmptyState title="No forms yet" action={<div className="flex gap-2">{create}</div>}>
        <p>
          Create a form from scratch, or start from a template for feedback from the people you
          support.
        </p>
      </EmptyState>
    ) : (
      <EmptyState title={`No ${statusWords[status].toLowerCase()} forms`}>
        <p>Choose another status to see more forms.</p>
      </EmptyState>
    );
  }
  return (
    <>
      <DataTable
        caption="Forms, the most recently changed first"
        captionHidden
        columns={columns}
        rows={state.items}
        rowKey={(row) => row.id}
      />
      <ShowMore noun="forms" state={state} onClick={more} />
    </>
  );
}

/** The funder's forms, the most recently changed first. */
export default function FormsListPage() {
  const [status, setStatus] = useRemembered<Filter>('forms:filter', '');
  return (
    <FormsPage>
      <PageHeader
        title="Forms"
        description="Build a form, publish it, and read the responses. Anyone you choose can answer."
        actions={create}
      />
      <FormField label="Show" className="max-w-56">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as Filter);
          }}
        >
          <option value="">All forms</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
        </Select>
      </FormField>
      <FormsTable key={status} status={status} />
    </FormsPage>
  );
}
