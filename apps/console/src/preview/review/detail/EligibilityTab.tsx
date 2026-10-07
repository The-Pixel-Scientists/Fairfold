// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, Panel, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { eligibility } from '../featured.ts';

type Check = (typeof eligibility)[number];

const columns: readonly Column<Check>[] = [
  {
    key: 'rule',
    header: 'Rule',
    rowHeader: true,
    cell: (check) => <span className="block max-w-sm whitespace-normal">{check.rule}</span>,
  },
  { key: 'result', header: 'Result', cell: () => <Tag tone="success">Passed</Tag> },
  {
    key: 'evidence',
    header: 'What was checked',
    cell: (check) => (
      <span className="block max-w-xs whitespace-normal text-muted">{check.evidence}</span>
    ),
  },
];

/** The eligibility rules, each with its result and the evidence behind it. */
export function EligibilityTab() {
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Eligibility confirmed"
        headingLevel="h2"
        actions={<Tag tone="success">6 of 6 passed</Tag>}
      >
        <p className="max-w-prose text-body text-muted">
          The rules checked this application when it arrived on 1 March 2027. Ada Morgan read the
          results and confirmed eligibility on 2 March 2027. A person always makes the final call.
        </p>
      </Panel>
      <DataTable
        caption="Eligibility rules for Community Grants"
        columns={columns}
        rows={eligibility}
        rowKey={(check) => check.rule}
      />
    </div>
  );
}
