// SPDX-License-Identifier: AGPL-3.0-or-later

import { Panel, SummaryList, Tag } from '@pixel-scientists/ui';

import type { Submission } from '../../../contracts/index.ts';

/** The organisation and the person who applied, beside the answers. */
export function Aside({ submission }: { submission: Submission }) {
  const { organisation, contact } = submission;
  const name = [contact.givenName, contact.familyName].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Organisation">
        <SummaryList
          items={[
            { term: 'Name', value: organisation.name },
            { term: 'Legal form', value: organisation.legalForm },
            ...organisation.identifiers.map((identifier) => ({
              term: identifier.scheme,
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-all">{identifier.identifier}</span>
                  <Tag tone={identifier.verified ? 'success' : 'neutral'}>
                    {identifier.verified ? 'Verified' : 'Not verified'}
                  </Tag>
                </span>
              ),
            })),
          ]}
        />
      </Panel>
      <Panel title="Contact">
        <SummaryList
          items={[
            { term: 'Name', value: name === '' ? 'Not given' : name },
            {
              term: 'Email',
              value: (
                <a href={`mailto:${contact.email}`} className="break-all">
                  {contact.email}
                </a>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
