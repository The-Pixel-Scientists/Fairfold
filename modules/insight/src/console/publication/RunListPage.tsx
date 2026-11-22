// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, Link, PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { PublicationRun } from '../../contracts/index.ts';
import { loadPublicationRuns } from '../api.ts';
import { publicationKindLabels } from '../format.ts';
import { insightPath } from '../paths.ts';
import { LinkButton, useWho } from '../parts.tsx';
import { period, stateWords } from './runWords.ts';

export default function RunListPage() {
  const { state, retry } = useLoad(loadPublicationRuns);
  const who = useWho();
  const columns: readonly Column<PublicationRun>[] = [
    {
      key: 'kind',
      header: 'Kind',
      rowHeader: true,
      cell: (run) => (
        <Link to={insightPath('publication-run', { id: run.id })} className="font-medium underline">
          {publicationKindLabels[run.kind]}
        </Link>
      ),
    },
    { key: 'period', header: 'Period', cell: period },
    { key: 'state', header: 'State', cell: (run) => stateWords(run, who) },
    { key: 'by', header: 'Prepared by', cell: (run) => who(run.preparedByMembershipId) },
  ];
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Publication runs"
        description="Prepare a file or figures, check them, then submit them yourself. Nothing here sends anything to anyone."
        actions={
          <LinkButton to={insightPath('publication-new')} variant="primary">
            Prepare a run
          </LinkButton>
        }
      />
      <WhenLoaded state={state} label="Loading publication runs" retry={retry}>
        {({ runs }) => (
          <DataTable
            caption="Publication runs, newest first"
            captionHidden
            columns={columns}
            rows={runs}
            rowKey={(run) => run.id}
            empty={<p>There are no runs yet. Choose "Prepare a run" to make the first.</p>}
          />
        )}
      </WhenLoaded>
    </div>
  );
}
