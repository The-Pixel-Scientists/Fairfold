// SPDX-License-Identifier: AGPL-3.0-or-later

import { legalForms } from '@pixel-scientists/party/contracts';
import type { ConsoleOrganisation } from '@pixel-scientists/party/contracts';
import {
  DataTable,
  Link,
  NotFoundPage,
  PageHeader,
  Panel,
  SummaryList,
  Tag,
  WhenLoaded,
  useLoad,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { Gate, useParam } from './Gate.tsx';
import { loadOrganisation } from './loaders.ts';
import { CRM_PATH, organisationPath, personPath } from './paths.ts';
import { FollowMerge, MergedNotice } from './Record.tsx';
import { Timeline } from './Timeline.tsx';
import { ValueHistory } from './ValueHistory.tsx';
import { personName, schemeWords } from './words.ts';

type Identifier = ConsoleOrganisation['identifiers'][number];
type Contact = ConsoleOrganisation['contacts'][number];

const identifierColumns: readonly Column<Identifier>[] = [
  { key: 'scheme', header: 'Register', rowHeader: true, cell: (row) => schemeWords(row.scheme) },
  { key: 'identifier', header: 'Number', cell: (row) => row.identifier },
  {
    key: 'verified',
    header: 'Checked',
    cell: (row) => (
      <Tag tone={row.verified ? 'success' : 'neutral'}>
        {row.verified ? 'Verified' : 'Unverified'}
      </Tag>
    ),
  },
];

const contactColumns: readonly Column<Contact>[] = [
  {
    key: 'name',
    header: 'Contact',
    rowHeader: true,
    cell: (row) => <Link to={personPath(row.personId)}>{personName(row)}</Link>,
  },
  { key: 'email', header: 'Email address', cell: (row) => row.email },
];

function Details({ organisation }: { organisation: ConsoleOrganisation }) {
  const { registeredAddress: address } = organisation;
  return (
    <Panel title="Details">
      <SummaryList
        items={[
          { term: 'Legal form', value: legalForms[organisation.legalForm] },
          {
            term: 'Registered address',
            value: [
              address.line1,
              address.line2,
              address.town,
              address.postcode,
              address.countryCode,
            ]
              .filter((line) => line !== null && line !== '')
              .map((line, index) => (
                <span key={index} className="block">
                  {line}
                </span>
              )),
          },
          { term: 'Website', value: organisation.website ?? 'Not given' },
        ]}
      />
    </Panel>
  );
}

function Loaded({ organisationId }: { organisationId: string }) {
  const { state, retry } = useLoad(loadOrganisation, organisationId);
  return (
    <WhenLoaded state={state} label="Loading the organisation" retry={retry}>
      {(record) => {
        if (record.state === 'not_found') return <NotFoundPage />;
        if (record.state === 'merged')
          return <FollowMerge to={organisationPath(record.survivorId)} />;
        const { organisation } = record;
        return (
          <>
            <PageHeader
              breadcrumbs={[
                { label: 'Organisations and people', to: CRM_PATH },
                { label: organisation.name },
              ]}
              title={organisation.name}
              eyebrow={
                record.status === 'archived' ? <Tag tone="neutral">Archived</Tag> : undefined
              }
              description={legalForms[organisation.legalForm]}
            />
            <MergedNotice />
            <Details organisation={organisation} />
            <Panel title="Identifiers">
              <DataTable
                caption="Identifiers of this organisation"
                captionHidden
                columns={identifierColumns}
                rows={organisation.identifiers}
                rowKey={(row) => `${row.scheme}:${row.identifier}`}
                empty={<p className="text-muted">This organisation has no identifiers yet.</p>}
              />
            </Panel>
            <Panel title="Contacts">
              <DataTable
                caption="Contacts of this organisation"
                captionHidden
                columns={contactColumns}
                rows={organisation.contacts}
                rowKey={(row) => row.personId}
                empty={<p className="text-muted">This organisation has no contacts yet.</p>}
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
            <ValueHistory kind="organisation" id={organisation.id} />
            <Timeline partyId={organisation.id} />
          </>
        );
      }}
    </WhenLoaded>
  );
}

/** One organisation: details, identifiers, contacts, lists, value history and timeline. */
export default function OrganisationPage() {
  const id = useParam('organisationId');
  return (
    <Gate>
      <Loaded key={id} organisationId={id} />
    </Gate>
  );
}
