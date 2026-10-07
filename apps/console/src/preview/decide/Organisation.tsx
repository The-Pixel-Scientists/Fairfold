// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: an organisation record, from the party core that Fairfold
// CRM owns and every Fairfold tool reads.

import { Button, DataTable, Link, PageHeader, Panel, SummaryList, Tag } from '@pixel-scientists/ui';
import type { Column, TagTone } from '@pixel-scientists/ui';

import { charityNumber, pounds } from '../story.ts';
import { Eyebrow, Notice } from './parts.tsx';

interface Person {
  name: string;
  role: string;
  contactFor: string;
  email: string;
  phone: string;
  main?: boolean;
}

const people: readonly Person[] = [
  {
    name: 'Sam Patel',
    role: 'Project lead',
    contactFor: 'Application and agreement',
    email: 'sam@example.org',
    phone: '01632 960412',
    main: true,
  },
  {
    name: 'Margaret Hale',
    role: 'Chair of trustees',
    contactFor: 'Signs the agreement',
    email: 'margaret.hale@example.org',
    phone: '01632 960457',
  },
  {
    name: 'Joyce Adeyemi',
    role: 'Treasurer',
    contactFor: 'Payments and accounts',
    email: 'joyce.adeyemi@example.org',
    phone: '01632 960458',
  },
];

interface Application {
  /** A draft has no reference until it is sent. */
  reference: string | null;
  round: string;
  project: string;
  requested: number | null;
  outcome: string;
  tone: TagTone;
  awarded: number | null;
}

const applications: readonly Application[] = [
  {
    reference: 'NF-CG-0412',
    round: 'Community Grants, Spring 2027',
    project: 'Riverside Lunch Club',
    requested: 12_500,
    outcome: 'Shortlisted',
    tone: 'info',
    awarded: null,
  },
  {
    reference: null,
    round: 'Green Spaces Fund, 2027',
    project: 'Riverside Pocket Garden',
    requested: null,
    outcome: 'Draft',
    tone: 'neutral',
    awarded: null,
  },
  {
    reference: 'NF-CG-0291',
    round: 'Community Grants, Autumn 2026',
    project: 'Winter Warm Space',
    requested: 8_000,
    outcome: 'Awarded',
    tone: 'success',
    awarded: 8_000,
  },
];

const peopleColumns: readonly Column<Person>[] = [
  {
    key: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (row) => (
      <div className="flex flex-col">
        <span className="flex items-center gap-2">
          {row.name}
          {row.main && <Tag>Main contact</Tag>}
        </span>
        <span className="text-xs font-normal text-muted">{row.role}</span>
      </div>
    ),
  },
  { key: 'for', header: 'Contact for', cell: (row) => row.contactFor },
  {
    key: 'contact',
    header: 'Email and phone',
    cell: (row) => (
      <div className="flex flex-col">
        <span>{row.email}</span>
        <span className="text-xs text-muted">{row.phone}</span>
      </div>
    ),
  },
];

const applicationColumns: readonly Column<Application>[] = [
  {
    key: 'project',
    header: 'Project',
    rowHeader: true,
    cell: (row) => (
      <div className="flex flex-col">
        <span>{row.project}</span>
        <span className="text-xs font-normal text-muted">{row.round}</span>
      </div>
    ),
  },
  {
    key: 'reference',
    header: 'Reference',
    cell: (row) =>
      row.reference === null ? (
        <span className="text-muted">Not sent yet</span>
      ) : row.reference === 'NF-CG-0412' ? (
        <Link to="/submissions/NF-CG-0412">{row.reference}</Link>
      ) : (
        row.reference
      ),
  },
  {
    key: 'requested',
    header: 'Requested',
    align: 'end',
    cell: (row) =>
      row.requested === null ? <span className="text-muted">Not yet</span> : pounds(row.requested),
  },
  { key: 'outcome', header: 'Status', cell: (row) => <Tag tone={row.tone}>{row.outcome}</Tag> },
  {
    key: 'awarded',
    header: 'Awarded',
    align: 'end',
    cell: (row) =>
      row.awarded === null ? <span className="text-muted">Not yet</span> : pounds(row.awarded),
  },
];

const tools = [
  ['Fairfold Grants', '2 applications and 1 draft, 1 grant awarded'],
  ['Fairfold Payments', '1 payment of £8,000, paid on 16 November 2026'],
  ['Fairfold CRM', 'The master record: 3 people, 3 relationships, 3 consents'],
] as const;

const consents = [
  {
    what: 'Newsletter from Northfield Foundation',
    given: true,
    how: 'Sam Patel, on the applicant portal, 14 September 2026',
  },
  {
    what: 'Stories and photos in our reports',
    given: true,
    how: 'Margaret Hale, by phone, recorded by Ada Morgan, 9 November 2026',
  },
  {
    what: 'Sharing contact details with other funders',
    given: false,
    how: 'Sam Patel, in the applicant portal, 1 March 2027',
  },
];

export default function Organisation() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Organisations', to: '/organisations' },
          { label: 'Northfield Community Trust' },
        ]}
        eyebrow={
          <Eyebrow>
            <Tag>Registered charity</Tag>
            <span>Organisation record</span>
          </Eyebrow>
        }
        title="Northfield Community Trust"
        description={`Charity number ${charityNumber}, working in Northfield Central.`}
        actions={<Button variant="primary">Edit details</Button>}
      />

      <Notice icon="link" tone="info" title="One record, shared by every Fairfold tool">
        Change a detail here and it changes in Fairfold Grants and Fairfold Payments too. There is
        no second copy to keep in step.
      </Notice>

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Details">
            <SummaryList
              items={[
                { term: 'Legal name', value: 'Northfield Community Trust' },
                {
                  term: 'Charity number',
                  value: (
                    <>
                      {charityNumber}
                      <span className="block text-sm text-muted">
                        Charity Commission, checked 2 March 2027
                      </span>
                    </>
                  ),
                },
                { term: 'Legal form', value: 'Charitable incorporated organisation' },
                {
                  term: 'Address',
                  value: (
                    <>
                      Riverside Hall
                      <br />
                      Mill Lane
                      <br />
                      Northfield
                      <br />
                      NF1 3QR
                    </>
                  ),
                },
                {
                  term: 'Website',
                  value: <a href="https://northfieldct.example">northfieldct.example</a>,
                },
                { term: 'Income band', value: '£100,000 to £250,000' },
              ]}
            />
          </Panel>

          <Panel title="People">
            <DataTable
              caption="People at Northfield Community Trust"
              captionHidden
              columns={peopleColumns}
              rows={people}
              rowKey={(row) => row.name}
            />
          </Panel>

          <Panel title="Applications">
            <DataTable
              caption="Applications from Northfield Community Trust across rounds"
              captionHidden
              columns={applicationColumns}
              rows={applications}
              rowKey={(row) => row.project}
            />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Used across Fairfold">
            <ul className="flex flex-col divide-y divide-divider">
              {tools.map(([name, detail]) => (
                <li key={name} className="flex flex-col py-2 first:pt-0 last:pb-0">
                  <span className="font-medium text-ink">{name}</span>
                  <span className="text-sm text-muted">{detail}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Relationships">
            <SummaryList
              items={[
                {
                  term: 'Funded by',
                  value: (
                    <>
                      Northfield Foundation
                      <span className="block text-sm text-muted">Since October 2026</span>
                    </>
                  ),
                },
                {
                  term: 'Co-funder',
                  value: (
                    <>
                      Northfield Parish Council
                      <span className="block text-sm text-muted">
                        £1,000 for Riverside Lunch Club
                      </span>
                    </>
                  ),
                },
                {
                  term: 'Partner',
                  value: (
                    <>
                      St Anne’s Food Pantry
                      <span className="block text-sm text-muted">Supplies surplus food</span>
                    </>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Consent">
            <ul className="flex flex-col divide-y divide-divider">
              {consents.map(({ what, given, how }) => (
                <li key={what} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 basis-40 font-medium text-ink">{what}</span>
                    <Tag tone={given ? 'success' : 'neutral'}>{given ? 'Given' : 'Not given'}</Tag>
                  </div>
                  <span className="text-sm text-muted">{how}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
