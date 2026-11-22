// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Notice,
  PageHeader,
  Panel,
  SummaryList,
  useLoad,
  useSubmit,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { disclosureFloor } from '../../contracts/index.ts';
import type { DisclosureRule } from '../../contracts/index.ts';
import { changeDisclosureRule, loadDisclosureRule } from '../api.ts';
import { formatDate } from '../format.ts';
import { useStepUp } from '../useStepUp.tsx';

const FIELDS = ['threshold', 'minimumGroup'] as const;

function tooLow(field: (typeof FIELDS)[number], floor: number) {
  return {
    field: `body.${field}`,
    message: `Enter ${field === 'threshold' ? 'a threshold' : 'a minimum group'} of ${String(floor)} or more.`,
  };
}

function Change({
  rule,
  onChanged,
  onCancel,
}: {
  rule: DisclosureRule;
  onChanged: (rule: DisclosureRule) => void;
  onCancel: () => void;
}) {
  const stepUp = useStepUp();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const form = useSubmit(FIELDS, async (data) => {
    const threshold = Number(data.get('threshold'));
    const minimumGroup = Number(data.get('minimumGroup'));
    const errors = [
      ...(threshold < disclosureFloor.threshold
        ? [tooLow('threshold', disclosureFloor.threshold)]
        : []),
      ...(minimumGroup < disclosureFloor.minimumGroup
        ? [tooLow('minimumGroup', disclosureFloor.minimumGroup)]
        : []),
    ];
    if (errors.length > 0) throw new ProblemError(400, 'Check the numbers.', { errors });
    const changed = await stepUp.run(() => changeDisclosureRule({ threshold, minimumGroup }));
    if (changed !== null) onChanged(changed);
  });
  return (
    <>
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-xl flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField
          label="Threshold"
          id="threshold"
          hint={`Counts below this are hidden. At least ${String(disclosureFloor.threshold)}.`}
          error={form.errorFor('threshold')}
        >
          <Input ref={first} name="threshold" inputMode="numeric" defaultValue={rule.threshold} />
        </FormField>
        <FormField
          label="Minimum group"
          id="minimumGroup"
          hint={`A table with fewer people than this is not shown at all. At least ${String(disclosureFloor.minimumGroup)}, and not less than the threshold.`}
          error={form.errorFor('minimumGroup')}
        >
          <Input name="minimumGroup" inputMode="numeric" defaultValue={rule.minimumGroup} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Save threshold
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </form>
      {stepUp.dialog}
    </>
  );
}

function Content({ initial }: { initial: DisclosureRule }) {
  const [rule, setRule] = useState(initial);
  const [changing, setChanging] = useState(false);
  const [saved, setSaved] = useState('');
  const changeButton = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);
  useEffect(() => {
    if (!changing && closed.current) changeButton.current?.focus();
  }, [changing]);
  const close = () => {
    closed.current = true;
    setChanging(false);
  };
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Disclosure rule"
        description="How small a group has to be before its numbers are hidden in equality monitoring reports."
        actions={
          changing ? undefined : (
            <Button
              ref={changeButton}
              onClick={() => {
                setSaved('');
                setChanging(true);
              }}
            >
              Change threshold
            </Button>
          )
        }
      />
      <p role="status" className="text-body font-medium text-success empty:sr-only">
        {saved}
      </p>
      <Panel title="Applied now">
        <SummaryList
          items={[
            { term: 'Threshold', value: `Fewer than ${String(rule.threshold)} people are hidden` },
            {
              term: 'Minimum group',
              value: `A table of fewer than ${String(rule.minimumGroup)} people is not shown`,
            },
            { term: 'Secondary suppression', value: 'On. It is always on.' },
            {
              term: 'Version',
              value:
                rule.version === null
                  ? 'The platform minimum, which your funder has not changed'
                  : String(rule.version),
            },
            ...(rule.updatedAt === null
              ? []
              : [{ term: 'Last changed', value: formatDate(rule.updatedAt) }]),
          ]}
        />
      </Panel>
      {changing ? (
        <Panel title="Change threshold">
          <Notice
            tone="info"
            title="You can raise these, never lower them below the platform minimum"
          >
            The minimum threshold is {disclosureFloor.threshold} and the minimum group is{' '}
            {disclosureFloor.minimumGroup}. You may be asked to confirm it is you.
          </Notice>
          <Change
            rule={rule}
            onChanged={(next) => {
              setRule(next);
              setSaved(`Threshold saved. Version ${String(next.version)} now applies.`);
              close();
            }}
            onCancel={close}
          />
        </Panel>
      ) : null}
    </div>
  );
}

export default function DisclosurePage() {
  const { state, retry } = useLoad(loadDisclosureRule);
  return (
    <WhenLoaded state={state} label="Loading the disclosure rule" retry={retry}>
      {(rule) => <Content initial={rule} />}
    </WhenLoaded>
  );
}
