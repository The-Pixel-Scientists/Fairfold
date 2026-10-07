// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Read-only pieces of an application that staff and reviewers both see: a
// section of answers, and the budget with its total, other funding and the
// amount requested.

import { AnswerView, DataTable } from '@pixel-scientists/ui';
import type { Column, FormAnswers, FormSectionDefinition } from '@pixel-scientists/ui';

import { pounds } from '../story.ts';

const helpers = {
  formatMoney: ({ amountMinor }: { amountMinor: number }) => pounds(amountMinor / 100),
};

/** One section's questions with their answers, from the fields the server sent. */
export function AnswerSection({
  section,
  answers,
}: {
  section: FormSectionDefinition;
  answers: FormAnswers;
}) {
  return (
    <AnswerView
      sections={[section]}
      visible={section.fields}
      answers={answers}
      helpers={helpers}
      headingLevel="h2"
    />
  );
}

export interface BudgetLine {
  item: string;
  detail: string;
  cost: number;
}

interface BudgetRow extends BudgetLine {
  total?: boolean;
}

const columns: readonly Column<BudgetRow>[] = [
  {
    key: 'item',
    header: 'Item',
    rowHeader: true,
    cell: (row) => <span className={row.total ? 'font-semibold' : undefined}>{row.item}</span>,
  },
  {
    key: 'detail',
    header: 'Detail',
    cell: (row) => <span className="text-muted">{row.detail}</span>,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'end',
    cell: (row) => (
      <span className={row.total ? 'font-semibold' : undefined}>
        {row.cost < 0 ? `\u2212${pounds(-row.cost)}` : pounds(row.cost)}
      </span>
    ),
  },
];

/** The budget as a table that ends with the total, the other funding and the amount asked for. */
export function BudgetTable({
  lines,
  otherFunding,
}: {
  lines: readonly BudgetLine[];
  otherFunding: { source: string; amount: number };
}) {
  const total = lines.reduce((sum, line) => sum + line.cost, 0);
  const rows: readonly BudgetRow[] = [
    ...lines,
    { item: 'Total cost of the project', detail: '', cost: total, total: true },
    { item: 'Other funding', detail: otherFunding.source, cost: -otherFunding.amount },
    {
      item: 'Amount requested',
      detail: 'Total cost minus other funding',
      cost: total - otherFunding.amount,
      total: true,
    },
  ];
  return (
    <section aria-labelledby="budget-heading" className="flex flex-col gap-2">
      <h2 id="budget-heading" className="text-lg font-semibold text-ink">
        Budget
      </h2>
      <DataTable
        caption="Project budget"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(row) => row.item}
      />
    </section>
  );
}
