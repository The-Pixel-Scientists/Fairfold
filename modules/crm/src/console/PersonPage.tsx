// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ConsolePerson } from '@pixel-scientists/party/contracts';
import {
  DataTable,
  Link,
  NotFoundPage,
  PageHeader,
  PageHeading,
  Panel,
  SummaryList,
  Tag,
  WhenLoaded,
  useLoad,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { Gate, useParam } from './Gate.tsx';
import { loadPerson } from './loaders.ts';
import { CRM_PATH, organisationPath, personPath } from './paths.ts';
import { FollowMerge, MergedNotice } from './Record.tsx';
import { Timeline } from './Timeline.tsx';
import { ValueHistory } from './ValueHistory.tsx';
import { personName } from './words.ts';

type Organisation = ConsolePerson['organisations'][number];

const organisationColumns: readonly Column<Organisation>[] = [
  {
    key: 'name',
    header: 'Organisation',
    rowHeader: true,
    cell: (row) => <Link to={organisationPath(row.id)}>{row.name}</Link>,
  },
];

function Loaded({ personId }: { personId: string }) {
  const { state, retry } = useLoad(loadPerson, personId);
  return (
    <WhenLoaded state={state} label="Loading the person" retry={retry}>
      {(record) => {
        if (record.state === 'not_found') return <NotFoundPage />;
        if (record.state === 'merged') return <FollowMerge to={personPath(record.survivorId)} />;
        if (record.state === 'erased') {
          return (
            <>
              <PageHeading>Erased person</PageHeading>
              <p className="max-w-prose text-body text-muted">
                This person's details have been erased, so only their status is kept.
              </p>
              <Tag tone="neutral">Erased</Tag>
            </>
          );
        }
        const { person } = record;
        const name = personName(person);
        return (
          <>
            <PageHeader
              breadcrumbs={[{ label: 'Organisations and people', to: CRM_PATH }, { label: name }]}
              title={name}
              eyebrow={
                record.status === 'archived' ? <Tag tone="neutral">Archived</Tag> : undefined
              }
            />
            <MergedNotice />
            <Panel title="Details">
              <SummaryList
                items={[
                  { term: 'Email address', value: person.email },
                  { term: 'Phone number', value: person.phone ?? 'Not given' },
                ]}
              />
            </Panel>
            <Panel title="Contact for">
              <DataTable
                caption="Organisations this person is a contact for"
                captionHidden
                columns={organisationColumns}
                rows={person.organisations}
                rowKey={(row) => row.id}
                empty={
                  <p className="text-muted">This person is not a contact for any organisation.</p>
                }
              />
            </Panel>
            {record.lists.length > 0 && (
              <Panel title="Lists">
                <ul className="flex flex-col gap-1">
                  {record.lists.map((list) => (
                    <li key={list.id}>{list.name}</li>
                  ))}
                </ul>
              </Panel>
            )}
            <ValueHistory kind="person" id={person.id} />
            <Timeline partyId={person.id} />
          </>
        );
      }}
    </WhenLoaded>
  );
}

/** One person: details, the organisations they are a contact for, lists, value history and timeline. */
export default function PersonPage() {
  const id = useParam('personId');
  return (
    <Gate>
      <Loaded key={id} personId={id} />
    </Gate>
  );
}
