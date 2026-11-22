// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  Button,
  DateInput,
  ErrorSummary,
  FormField,
  Notice,
  PageHeader,
  Select,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { publicationKinds } from '../../contracts/index.ts';
import type { PublicationKind } from '../../contracts/index.ts';
import { prepareRun } from '../api.ts';
import { publicationKindLabels } from '../format.ts';
import { insightPath } from '../paths.ts';

const FIELDS = ['kind', 'periodStart', 'periodEnd'] as const;

function missing(field: string, message: string) {
  return new ProblemError(400, 'Check the dates.', {
    errors: [{ field: `body.${field}`, message }],
  });
}

/** Asks for a kind and a period, and prepares one run: a double press or a retry sends the same key. */
export default function PrepareRunPage() {
  const [kind, setKind] = useState<PublicationKind>('three_sixty_giving');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const attempt = useRef<{ sent: string; key: string } | null>(null);
  const navigate = useNavigate();

  const form = useSubmit(FIELDS, async () => {
    if (start === null) throw missing('periodStart', 'Enter the start date.');
    if (end === null) throw missing('periodEnd', 'Enter the end date.');
    const body = { kind, periodStart: start, periodEnd: end };
    const sent = JSON.stringify(body);
    const key = attempt.current?.sent === sent ? attempt.current.key : undefined;
    try {
      const run = await prepareRun(body, key);
      attempt.current = null;
      navigate(insightPath('publication-run', { id: run.id }));
    } catch (error) {
      if (error instanceof ProblemError && error.idempotencyKey !== null) {
        attempt.current = { sent, key: error.idempotencyKey };
      }
      throw error;
    }
  });

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Prepare a run"
        breadcrumbs={[
          { label: 'Publication runs', to: insightPath('publication') },
          { label: 'Prepare a run' },
        ]}
      />
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-xl flex-col gap-5">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField label="Kind of run" id="kind" error={form.errorFor('kind')}>
          <Select
            name="kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as PublicationKind);
            }}
          >
            {publicationKinds.map((value) => (
              <option key={value} value={value}>
                {publicationKindLabels[value]}
              </option>
            ))}
          </Select>
        </FormField>
        <DateInput
          legend="Period start"
          id="periodStart"
          hint="For example 1 4 2027."
          error={form.errorFor('periodStart')}
          value={start}
          onChange={setStart}
        />
        <DateInput
          legend="Period end"
          id="periodEnd"
          hint="The end date must be after the start date."
          error={form.errorFor('periodEnd')}
          value={end}
          onChange={setEnd}
        />
        <Notice tone="info" title="You review it, then you submit it">
          Preparing a run makes a file or figures for you to check. The software does not send
          anything to 360Giving, the Charity Commission or anyone else.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Prepare a run
          </Button>
          <Button
            onClick={() => {
              navigate(insightPath('publication'));
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
