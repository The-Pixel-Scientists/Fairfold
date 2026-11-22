// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  WhenLoaded,
  buttonClassName,
  useLoad,
  useNavigate,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { Gate } from '../Gate.tsx';
import { loadChecklists } from '../loaders.ts';
import { NEW_CHECKLIST_PATH, checklistPath } from '../paths.ts';
import { formatMoment } from '../words.ts';

type Rows = Awaited<ReturnType<typeof loadChecklists>>['checklists'];

const columns: readonly Column<Rows[number]>[] = [
  {
    key: 'name',
    header: 'Checklist',
    rowHeader: true,
    cell: (row) => <Link to={checklistPath(row.id)}>{row.name}</Link>,
  },
  {
    key: 'version',
    header: 'Current version',
    cell: (row) => `Version ${String(row.versionNumber)}`,
  },
  { key: 'published', header: 'Published', cell: (row) => formatMoment(row.publishedAt) },
];

function List({ rows }: { rows: Rows }) {
  const navigate = useNavigate();
  return (
    <DataTable
      caption="Due diligence checklists"
      captionHidden
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onOpenRow={(row) => {
        navigate(checklistPath(row.id));
      }}
      empty={
        <EmptyState
          title="No checklists yet"
          headingLevel="h2"
          action={
            <Link to={NEW_CHECKLIST_PATH} className={buttonClassName('primary')}>
              Create checklist
            </Link>
          }
        >
          <p>
            A checklist lists the checks to make on an application. Create one, then staff answer it
            for each application.
          </p>
        </EmptyState>
      }
    />
  );
}

function Screen() {
  const { state, retry } = useLoad(loadChecklists);
  return (
    <>
      <PageHeader
        title="Checklists"
        description="Due diligence checks, versioned. Publishing a change makes a new version and keeps every earlier answer."
        actions={
          <Link to={NEW_CHECKLIST_PATH} className={buttonClassName('primary')}>
            Create checklist
          </Link>
        }
      />
      <WhenLoaded state={state} label="Loading checklists" retry={retry}>
        {({ checklists }) => <List rows={checklists} />}
      </WhenLoaded>
    </>
  );
}

export default function ChecklistsPage() {
  return (
    <Gate permission="assure.checklists.manage">
      <Screen />
    </Gate>
  );
}
