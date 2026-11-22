// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import type { FieldProblem } from '@pixel-scientists/domain/platform';
import {
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Select,
  useSubmit,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { createTarget, removeTarget, updateTarget } from '../contracts/index.ts';
import type { Framework, Target } from '../contracts/index.ts';
import { figureIn, periodProblems, refuse } from './forms.ts';
import { FormDialog, None, RemoveDialog, RowButton, Section } from './Page.tsx';
import { naming, topField } from './problems.ts';
import { figureLabel, figureText, formatFigure, formatPeriod } from './words.ts';

const FIELDS = ['indicatorId', 'periodStart', 'periodEnd', 'baseline', 'target'];

/** Adds a target or, given one, changes its figures. Its indicator, period and scope stay as they were. */
function TargetDialog({
  framework,
  target,
  onClose,
  onSaved,
}: {
  framework: Framework;
  target?: Target;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [indicatorId, setIndicatorId] = useState(target?.indicatorId ?? '');
  const [periodStart, setPeriodStart] = useState(target?.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(target?.periodEnd ?? '');
  const indicator = framework.indicators[indicatorId];
  const [baseline, setBaseline] = useState(
    target?.baseline === undefined || target.baseline === null || indicator === undefined
      ? ''
      : figureText(indicator.unit, target.baseline),
  );
  const [figure, setFigure] = useState(
    target === undefined || indicator === undefined
      ? ''
      : figureText(indicator.unit, target.target),
  );

  const form = useSubmit(
    FIELDS,
    naming(topField, async () => {
      const problems: FieldProblem[] = [];
      if (indicator === undefined) {
        problems.push({ field: 'indicatorId', message: 'Choose an indicator.' });
      }
      if (target === undefined) problems.push(...periodProblems(periodStart, periodEnd));
      const unit = indicator?.unit ?? 'number';
      const goal = figureIn('target', unit, figure, problems);
      const start = baseline.trim() === '' ? null : figureIn('baseline', unit, baseline, problems);
      refuse(problems);
      if (target === undefined) {
        await call(createTarget, {
          body: {
            frameworkId: framework.id,
            indicatorId,
            programmeId: null,
            periodStart,
            periodEnd,
            baseline: start,
            target: goal,
          },
        });
      } else {
        await call(updateTarget, {
          params: { targetId: target.id },
          body: { baseline: start, target: goal },
        });
      }
      onSaved();
    }),
  );

  return (
    <FormDialog
      title={target === undefined ? 'Set a target' : 'Change target'}
      description={
        target === undefined
          ? 'A target is the figure you aim for over a period.'
          : `${indicator?.name ?? ''}, ${formatPeriod(target.periodStart, target.periodEnd)}`
      }
      submit={target === undefined ? 'Set target' : 'Save target'}
      form={form}
      onClose={onClose}
    >
      {target === undefined && (
        <>
          <FormField id="indicatorId" label="Indicator" error={form.errorFor('indicatorId')}>
            <Select
              value={indicatorId}
              onChange={(event) => {
                setIndicatorId(event.currentTarget.value);
              }}
            >
              <option value="">Choose an indicator</option>
              {Object.entries(framework.indicators).map(([id, { name }]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="periodStart" label="Period starts" error={form.errorFor('periodStart')}>
              <Input
                type="date"
                value={periodStart}
                onChange={(event) => {
                  setPeriodStart(event.currentTarget.value);
                }}
              />
            </FormField>
            <FormField id="periodEnd" label="Period ends" error={form.errorFor('periodEnd')}>
              <Input
                type="date"
                value={periodEnd}
                onChange={(event) => {
                  setPeriodEnd(event.currentTarget.value);
                }}
              />
            </FormField>
          </div>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="target"
          label={figureLabel('Target', indicator?.unit)}
          error={form.errorFor('target')}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={figure}
            onChange={(event) => {
              setFigure(event.currentTarget.value);
            }}
          />
        </FormField>
        <FormField
          id="baseline"
          label={figureLabel('Baseline', indicator?.unit)}
          optional
          hint="Where you started, for measuring progress."
          error={form.errorFor('baseline')}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={baseline}
            onChange={(event) => {
              setBaseline(event.currentTarget.value);
            }}
          />
        </FormField>
      </div>
    </FormDialog>
  );
}

type Open = { kind: 'new' } | { kind: 'change' | 'remove'; target: Target } | null;

/** A framework's targets, with a way to set, change and remove them for a member who may. */
export function TargetsSection({
  framework,
  targets,
  canChange,
  reload,
}: {
  framework: Framework;
  targets: readonly Target[];
  canChange: boolean;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => {
    setOpen(null);
  };
  const saved = () => {
    close();
    return reload();
  };

  const nameOf = (target: Target) => framework.indicators[target.indicatorId]?.name ?? '';
  const columns: readonly Column<Target>[] = [
    { key: 'indicator', header: 'Indicator', rowHeader: true, cell: nameOf },
    {
      key: 'period',
      header: 'Period',
      cell: ({ periodStart, periodEnd }) => formatPeriod(periodStart, periodEnd),
    },
    {
      key: 'baseline',
      header: 'Baseline',
      align: 'end',
      cell: (row) => {
        const unit = framework.indicators[row.indicatorId]?.unit;
        return row.baseline === null || unit === undefined ? (
          <None />
        ) : (
          formatFigure(unit, row.baseline)
        );
      },
    },
    {
      key: 'target',
      header: 'Target',
      align: 'end',
      cell: (row) => {
        const unit = framework.indicators[row.indicatorId]?.unit;
        return unit === undefined ? row.target : formatFigure(unit, row.target);
      },
    },
    {
      key: 'scope',
      header: 'Applies to',
      cell: (row) => (row.programmeId === null ? 'All programmes' : 'One programme'),
    },
    ...(canChange
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (row: Target) => {
              const name = `target for ${nameOf(row)}, ${formatPeriod(row.periodStart, row.periodEnd)}`;
              return (
                <span className="flex gap-1">
                  <RowButton
                    label="Change"
                    target={name}
                    onClick={() => {
                      setOpen({ kind: 'change', target: row });
                    }}
                  />
                  <RowButton
                    label="Remove"
                    target={name}
                    onClick={() => {
                      setOpen({ kind: 'remove', target: row });
                    }}
                  />
                </span>
              );
            },
          },
        ]
      : []),
  ];

  const hasIndicators = Object.keys(framework.indicators).length > 0;
  return (
    <Section
      title="Targets"
      action={
        canChange &&
        hasIndicators && (
          <Button
            onClick={() => {
              setOpen({ kind: 'new' });
            }}
          >
            Set a target
          </Button>
        )
      }
    >
      {targets.length === 0 ? (
        <EmptyState title="No targets yet">
          <p>
            {hasIndicators
              ? canChange
                ? 'Set a target for an indicator over a period, then record results to see progress towards it.'
                : 'Targets appear here once someone who sets up outcomes adds them.'
              : 'Add an indicator to the framework first. Then you can set targets for it.'}
          </p>
        </EmptyState>
      ) : (
        <DataTable
          caption="Targets"
          captionHidden
          columns={columns}
          rows={targets}
          rowKey={(row) => row.id}
        />
      )}
      {open?.kind === 'new' && (
        <TargetDialog framework={framework} onClose={close} onSaved={() => void saved()} />
      )}
      {open?.kind === 'change' && (
        <TargetDialog
          framework={framework}
          target={open.target}
          onClose={close}
          onSaved={() => void saved()}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveDialog
          title="Remove this target?"
          description={`${nameOf(open.target)}, ${formatPeriod(open.target.periodStart, open.target.periodEnd)}. Results you have recorded stay.`}
          submit="Remove target"
          onClose={close}
          action={async () => {
            await call(removeTarget, { params: { targetId: open.target.id } });
            await saved();
          }}
        />
      )}
    </Section>
  );
}
