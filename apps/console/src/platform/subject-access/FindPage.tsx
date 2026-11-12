// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Finds a person to export or erase. The term goes in the request body and
// stays in this page's state: never in the address, history or storage.

import { partySearchRequestSchema, searchParties } from '@pixel-scientists/crm/contracts';
import type { PartySearchPage } from '@pixel-scientists/crm/contracts';
import { ProblemError } from '@pixel-scientists/domain/api';
import { messageForIssue } from '@pixel-scientists/domain/platform';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Link,
  PageHeader,
  Tag,
  buttonClassName,
  formText,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { personPath } from './paths.ts';

const statusWords = {
  active: 'Active',
  archived: 'Archived',
  merged: 'Merged',
  erased: 'Erased',
} as const;

type Result = PartySearchPage['results'][number];

async function search(term: string): Promise<PartySearchPage> {
  const body = partySearchRequestSchema.safeParse({ term, kinds: ['person'] });
  if (!body.success) {
    const message = body.error.issues[0] ? messageForIssue(body.error.issues[0]) : '';
    throw new ProblemError(400, message, { errors: [{ field: 'body.term', message }] });
  }
  return callApi(searchParties, { body: body.data });
}

/** Finds a person by name or email address, then goes to their page. */
export default function FindPage() {
  const [found, setFound] = useState<PartySearchPage | null>(null);
  const form = useSubmit(['term'], async (data) => {
    setFound(await search(formText(data, 'term')));
  });

  return (
    <div className="flex max-w-4xl flex-col gap-stack">
      <PageHeader
        title="Subject access and erasure"
        description="Find a person, then export everything held about them or erase their personal data. Both ask you to confirm it is you first."
      />
      <SettingsSections />
      <form
        noValidate
        onSubmit={form.onSubmit}
        aria-label="Find a person"
        className="flex max-w-md flex-col gap-4"
      >
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField
          label="Name or email address"
          id="term"
          hint="Enter at least 2 characters."
          error={form.errorFor('term')}
        >
          <Input name="term" type="search" autoComplete="off" spellCheck={false} />
        </FormField>
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Find person
          </Button>
        </div>
      </form>
      <p role="status" className="text-body text-muted">
        {found === null
          ? ''
          : found.results.length === 0
            ? 'No people found.'
            : `${found.results.length}${found.nextCursor === null ? '' : ' or more'} ${found.results.length === 1 ? 'person' : 'people'} found.`}
      </p>
      {found !== null && (
        <>
          <DataTable<Result>
            caption="People found"
            captionHidden
            rows={found.results}
            rowKey={(row) => row.id}
            empty={
              <EmptyState title="No people found">
                <p>
                  Check the spelling, or try an email address. A person with no record in your
                  funder cannot be found here.
                </p>
              </EmptyState>
            }
            columns={[
              { key: 'name', header: 'Name', rowHeader: true, cell: (row) => row.label },
              {
                key: 'status',
                header: 'Status',
                cell: (row) =>
                  row.status === 'active' ? (
                    <Tag tone="success">Active</Tag>
                  ) : (
                    <Tag tone="neutral">{statusWords[row.status]}</Tag>
                  ),
              },
              {
                key: 'action',
                header: <span className="sr-only">Action</span>,
                align: 'end',
                cell: (row) =>
                  row.status === 'erased' || row.status === 'merged' ? null : (
                    <Link
                      to={personPath(row.id)}
                      aria-label={`Choose ${row.label}`}
                      className={buttonClassName('secondary')}
                    >
                      Choose
                    </Link>
                  ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
