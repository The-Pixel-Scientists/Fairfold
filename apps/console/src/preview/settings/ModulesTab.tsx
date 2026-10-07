// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Panel, Tag } from '@pixel-scientists/ui';

const planned = [
  [
    'Fairfold CRM',
    'Relationships, interactions and consent, built on the shared record of organisations and people.',
  ],
  [
    'Fairfold Payments',
    'Grant payments, donations and money owed, through regulated payment providers.',
  ],
  [
    'Fairfold Due Diligence',
    'Checks on applicants and grantees, from registry lookups to monitoring visits.',
  ],
  ['Fairfold Impact', 'Outcomes, indicators and evidence.'],
  ['Fairfold Activities', 'A charity’s own direct charitable activities, beside its grants.'],
  ['Fairfold Governance', 'Boards, board packs, decisions, risks, policies and incidents.'],
] as const;

const rowClassName =
  'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0';

/** Which Fairfold tools are on for the funder, and which are still to come. */
export function ModulesTab() {
  return (
    <div className="flex flex-col gap-stack">
      <Panel title="Available modules">
        <p className="text-body text-muted">
          Switch a module off to hide it from everyone at your funder. Nothing is deleted.
        </p>
        <ul role="list" className="flex flex-col divide-y divide-divider">
          <li className={rowClassName}>
            <div className="flex flex-col">
              <h3 className="flex items-center gap-2 text-body font-medium text-ink">
                Grants <Tag tone="success">On</Tag>
              </h3>
              <p className="text-body text-muted">
                Programmes, forms, applications, reviews and decisions.
              </p>
            </div>
            <Button>Switch off Grants</Button>
          </li>
        </ul>
      </Panel>
      <Panel title="Planned for 2027">
        <p className="text-body text-muted">
          Each tool works on its own or beside the others, on one shared record of organisations and
          people. You switch a tool on here once it is ready.
        </p>
        <ul role="list" className="flex flex-col divide-y divide-divider">
          {planned.map(([name, about]) => (
            <li key={name} className={rowClassName}>
              <div className="flex min-w-0 flex-1 basis-64 flex-col">
                <h3 className="text-body font-medium text-ink">{name}</h3>
                <p className="text-body text-muted">{about}</p>
              </div>
              <Tag>Planned</Tag>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
