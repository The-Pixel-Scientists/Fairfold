// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  asProblem,
  Button,
  DataTable,
  EmptyState,
  ErrorSummary,
  Link,
  PageHeader,
  Tag,
  useLoad,
  useNavigate,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { createFormDraft, formVersionStatuses } from '../../contracts/index.ts';
import type { FormVersionSummary, Round } from '../../contracts/index.ts';
import { formatMoment } from '../programme/format.ts';
import { LinkButton, ManagePage, None, useParam } from '../programme/Page.tsx';
import { formCrumbs } from './breadcrumbs.ts';
import { loadVersions } from './loaders.ts';
import { formVersionPath } from './paths.ts';

function columns(round: Round): readonly Column<FormVersionSummary>[] {
  return [
    {
      key: 'version',
      header: 'Version',
      rowHeader: true,
      cell: (version) => `Version ${String(version.version)}`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (version) => (
        <Tag tone={version.status === 'published' ? 'success' : 'neutral'}>
          {formVersionStatuses[version.status]}
        </Tag>
      ),
    },
    {
      key: 'published',
      header: 'Published',
      cell: (version) =>
        version.publishedAt === null ? (
          <None />
        ) : (
          <>
            {formatMoment(version.publishedAt, round.timeZone)}
            {version.publishedBy !== null && (
              <span className="text-sm text-muted">
                {' '}
                by {version.publishedBy.name ?? 'a team member'}
              </span>
            )}
          </>
        ),
    },
    {
      key: 'saved',
      header: 'Last saved',
      cell: (version) => formatMoment(version.updatedAt, round.timeZone),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (version) => (
        <Link to={formVersionPath(round.id, version.id)}>
          {version.status === 'draft' ? 'Edit draft' : 'View'}
          <span className="sr-only"> version {version.version}</span>
        </Link>
      ),
    },
  ];
}

/** Starts a draft from the latest published version, or empty, and opens it. */
function useCreateDraft(roundId: string) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  async function create() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      const draft = await call(createFormDraft, { params: { roundId } });
      navigate(formVersionPath(roundId, draft.id));
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
      setAttempt((count) => count + 1);
      running.current = false;
      setPending(false);
    }
  }
  return { create, pending, attempt, problem };
}

function Versions({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(loadVersions, roundId);
  const draft = useCreateDraft(roundId);
  const loaded = state.status === 'ready' ? state.value : null;
  const open = loaded?.versions.find((version) => version.status === 'draft');
  const create = (
    <Button
      id="create-draft"
      variant="primary"
      aria-disabled={draft.pending || undefined}
      onClick={() => void draft.create()}
    >
      Create draft
    </Button>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={loaded ? formCrumbs(loaded.programme, loaded.round) : undefined}
        title="Application form"
        description="The questions applicants answer for this round. A published version never changes, and applications keep the version they were submitted on."
        actions={
          open !== undefined ? (
            <LinkButton to={formVersionPath(roundId, open.id)} variant="primary">
              Edit draft
            </LinkButton>
          ) : loaded !== null && loaded.versions.length > 0 ? (
            create
          ) : undefined
        }
      />
      <ErrorSummary
        key={draft.attempt}
        errors={draft.problem === null ? [] : [{ fieldId: 'create-draft', message: draft.problem }]}
      />
      <WhenLoaded state={state} label="Loading the form" retry={retry}>
        {({ round, versions }) => (
          <DataTable
            caption="Versions of the form"
            captionHidden
            columns={columns(round)}
            rows={versions}
            rowKey={(version) => version.id}
            empty={
              <EmptyState title="No form yet" action={create}>
                <p>
                  Create a draft to build the form applicants fill in for {round.title}. You can add
                  sections and questions, or import a form from a file, then preview it and publish
                  version 1.
                </p>
              </EmptyState>
            }
          />
        )}
      </WhenLoaded>
    </>
  );
}

/** A round's form: its versions, the draft being built, and a way to start one. */
export default function FormPage() {
  return (
    <ManagePage title="Application form">
      <Versions roundId={useParam('roundId')} />
    </ManagePage>
  );
}
