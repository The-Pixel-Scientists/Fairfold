// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  CheckboxGroup,
  ErrorSummary,
  FormField,
  Input,
  Notice,
  PageHeader,
  Panel,
  RadioGroup,
  Select,
  Textarea,
  useLeaveGuard,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import { useContext, useEffect, useRef, useState } from 'react';

import {
  createDpia,
  getDpia,
  listProcessingActivities,
  updateDpia,
} from '../../contracts/index.ts';
import type { Dpia } from '../../contracts/index.ts';
import { UnsavedContext, useOnce, useRead, useZone } from '../hooks.ts';
import { Options, Reading } from '../parts.tsx';
import { viewPath } from '../paths.ts';
import {
  answerWords,
  dpiaWords,
  formatDate,
  formatMoment,
  likelihoodWords,
  severityWords,
} from '../words.ts';
import { screeningItems } from './screening.ts';
import { SignOffDialog } from './SignOffDialog.tsx';

interface Risk {
  id: string;
  description: string;
  likelihood: string;
  severity: string;
  mitigation: string;
}

interface Draft {
  title: string;
  activityIds: string[];
  screening: Record<string, string>;
  risks: Risk[];
  dpoAdvice: string;
  status: string;
}

const FIELDS = ['title', 'processingActivityIds', 'dpoAdvice', 'status'];

const blank: Draft = {
  title: '',
  activityIds: [],
  screening: {},
  risks: [],
  dpoAdvice: '',
  status: 'draft',
};

const draftOf = (dpia: Dpia): Draft => ({
  title: dpia.title,
  activityIds: dpia.processingActivityIds,
  screening: dpia.screening,
  risks: dpia.risks,
  dpoAdvice: dpia.dpoAdvice,
  status: dpia.status === 'in_review' ? 'in_review' : 'draft',
});

/** A new risk's stable id, kept as the risk is edited. */
const riskId = () => `r_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

const loadDpia = (dpiaId: string) => call(getDpia, { params: { dpiaId } });

/** Processing activities to link, for members who may read them; null when they may not. */
const loadActivities = () =>
  call(listProcessingActivities, { query: {} }).then(
    ({ activities }) => activities,
    () => null,
  );

function Form({ dpia }: { dpia: Dpia | null }) {
  const zone = useZone();
  const navigate = useNavigate();
  const once = useOnce();
  const markUnsaved = useContext(UnsavedContext);
  const activities = useRead(loadActivities);
  const [saved, setSaved] = useState<Dpia | null>(dpia);
  const initial = saved === null ? blank : draftOf(saved);
  const [draft, setDraft] = useState<Draft>(initial);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const focusId = useRef<string | null>(null);

  useEffect(() => {
    if (focusId.current !== null) {
      document.getElementById(focusId.current)?.focus();
      focusId.current = null;
    }
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useLeaveGuard(dirty);
  useEffect(() => {
    markUnsaved(dirty);
    return () => {
      markUnsaved(false);
    };
  }, [dirty, markUnsaved]);

  const change = (next: Partial<Draft>) => {
    setDone(false);
    setDraft({ ...draft, ...next });
  };
  const changeRisk = (id: string, next: Partial<Risk>) => {
    change({ risks: draft.risks.map((risk) => (risk.id === id ? { ...risk, ...next } : risk)) });
  };

  const addRisk = () => {
    const id = riskId();
    change({
      risks: [
        ...draft.risks,
        { id, description: '', likelihood: 'possible', severity: 'significant', mitigation: '' },
      ],
    });
    focusId.current = `${id}-description`;
  };
  /** Keeps focus in the list: the next risk, the one before, or the add button when none remain. */
  const removeRisk = (index: number) => {
    const risks = draft.risks.filter((_, at) => at !== index);
    change({ risks });
    const neighbour = risks[index] ?? risks[index - 1];
    focusId.current = neighbour === undefined ? 'add-risk' : `${neighbour.id}-description`;
  };

  const form = useSubmit(FIELDS, () =>
    once(async (idempotencyKey) => {
      const body = {
        title: draft.title,
        processingActivityIds: draft.activityIds,
        screening: draft.screening,
        risks: draft.risks,
        dpoAdvice: draft.dpoAdvice,
      };
      if (saved === null) {
        const created = await call(createDpia, {
          body,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        });
        markUnsaved(false);
        navigate(viewPath('dpia', created.id));
        return;
      }
      const updated = await call(updateDpia, {
        params: { dpiaId: saved.id },
        body: { ...body, status: draft.status },
      });
      setSaved(updated);
      setDraft(draftOf(updated));
      setDone(true);
    }),
  );

  const signable = saved !== null && (saved.status === 'draft' || saved.status === 'in_review');
  const options = activities.state.status === 'ready' ? activities.state.value : null;

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Data protection impact assessments', to: viewPath('dpias') },
          { label: saved?.title ?? 'New DPIA' },
        ]}
        title={saved?.title ?? 'New DPIA'}
        description={
          saved === null
            ? 'Start with the screening questions, then describe the risks and how you will reduce them.'
            : `${dpiaWords[saved.status]}${
                saved.signOff === null
                  ? ''
                  : `. Signed off at ${formatMoment(saved.signOff.signedOffAt, zone)}; review on ${formatDate(saved.signOff.reviewOn)}`
              }`
        }
        actions={
          signable &&
          (dirty ? (
            <p className="text-body text-muted">Save your changes before you sign off.</p>
          ) : (
            <Button
              onClick={() => {
                setSigning(true);
              }}
            >
              Sign off DPIA
            </Button>
          ))
        }
      />
      {saved !== null && (saved.status === 'signed_off' || saved.status === 'review_due') && (
        <Notice tone="info" title="This DPIA is signed off">
          <p>Saving changes reopens it as a draft. It needs signing off again.</p>
        </Notice>
      )}
      {done && (
        <p role="status" className="font-medium text-success">
          DPIA saved.
        </p>
      )}
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-stack">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <Panel title="About this assessment">
          <div className="flex max-w-2xl flex-col gap-4">
            <FormField label="Title" id="title" error={form.errorFor('title')}>
              <Input
                name="title"
                value={draft.title}
                onChange={(event) => {
                  change({ title: event.target.value });
                }}
              />
            </FormField>
            {saved !== null && (
              <FormField label="Status" id="status" error={form.errorFor('status')}>
                <Select
                  name="status"
                  value={draft.status}
                  onChange={(event) => {
                    change({ status: event.target.value });
                  }}
                >
                  <Options words={{ draft: dpiaWords.draft, in_review: dpiaWords.in_review }} />
                </Select>
              </FormField>
            )}
            {options !== null && options.length > 0 && (
              <CheckboxGroup
                legend="Processing activities it covers"
                id="processingActivityIds"
                name="processingActivityIds"
                values={draft.activityIds}
                onValuesChange={(activityIds) => {
                  change({ activityIds });
                }}
                options={options.map(({ id, name }) => ({ value: id, label: name }))}
                error={form.errorFor('processingActivityIds')}
              />
            )}
          </div>
        </Panel>
        <Panel title="Screening questions">
          <div className="flex max-w-2xl flex-col gap-4">
            {screeningItems.map((item) => (
              <RadioGroup
                key={item.id}
                legend={item.text}
                name={item.id}
                value={draft.screening[item.id] ?? ''}
                onValueChange={(value) => {
                  change({ screening: { ...draft.screening, [item.id]: value } });
                }}
                options={Object.entries(answerWords).map(([value, label]) => ({ value, label }))}
              />
            ))}
          </div>
        </Panel>
        <Panel
          title="Risks"
          actions={
            <Button id="add-risk" onClick={addRisk}>
              Add risk
            </Button>
          }
        >
          {draft.risks.length === 0 ? (
            <p className="text-body text-muted">
              No risks yet. Add each risk to people, how likely it is, how severe, and what you will
              do to reduce it.
            </p>
          ) : (
            <ol className="flex flex-col gap-6">
              {draft.risks.map((risk, index) => (
                <li
                  key={risk.id}
                  className="flex max-w-2xl flex-col gap-3 border-b border-divider pb-6 last:border-0 last:pb-0"
                >
                  <h3 className="text-body font-semibold">Risk {index + 1}</h3>
                  <FormField label="The risk" id={`${risk.id}-description`}>
                    <Textarea
                      value={risk.description}
                      onChange={(event) => {
                        changeRisk(risk.id, { description: event.target.value });
                      }}
                    />
                  </FormField>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="How likely" id={`${risk.id}-likelihood`}>
                      <Select
                        value={risk.likelihood}
                        onChange={(event) => {
                          changeRisk(risk.id, { likelihood: event.target.value });
                        }}
                      >
                        <Options words={likelihoodWords} />
                      </Select>
                    </FormField>
                    <FormField label="How severe" id={`${risk.id}-severity`}>
                      <Select
                        value={risk.severity}
                        onChange={(event) => {
                          changeRisk(risk.id, { severity: event.target.value });
                        }}
                      >
                        <Options words={severityWords} />
                      </Select>
                    </FormField>
                  </div>
                  <FormField label="How you will reduce it" id={`${risk.id}-mitigation`} optional>
                    <Textarea
                      value={risk.mitigation}
                      onChange={(event) => {
                        changeRisk(risk.id, { mitigation: event.target.value });
                      }}
                    />
                  </FormField>
                  <div>
                    <Button
                      variant="quiet"
                      aria-label={`Remove risk ${String(index + 1)}`}
                      onClick={() => {
                        removeRisk(index);
                      }}
                    >
                      Remove risk
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Advice from your data protection officer">
          <div className="max-w-2xl">
            <FormField label="Advice" id="dpoAdvice" optional error={form.errorFor('dpoAdvice')}>
              <Textarea
                name="dpoAdvice"
                value={draft.dpoAdvice}
                onChange={(event) => {
                  change({ dpoAdvice: event.target.value });
                }}
              />
            </FormField>
          </div>
        </Panel>
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Save DPIA
          </Button>
        </div>
      </form>
      {saved !== null && (
        <SignOffDialog
          open={signing}
          onClose={() => {
            setSigning(false);
          }}
          dpiaId={saved.id}
          onSigned={(signed) => {
            setSaved(signed);
            setDraft(draftOf(signed));
          }}
        />
      )}
    </div>
  );
}

export function DpiaPage({ dpiaId }: { dpiaId: string }) {
  return dpiaId === 'new' ? <Form dpia={null} /> : <Existing dpiaId={dpiaId} />;
}

function Existing({ dpiaId }: { dpiaId: string }) {
  const { state, reload } = useRead(loadDpia, dpiaId);
  return (
    <Reading state={state} label="Loading DPIA" retry={reload}>
      {(dpia) => <Form key={dpia.id} dpia={dpia} />}
    </Reading>
  );
}
