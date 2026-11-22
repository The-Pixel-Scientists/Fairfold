// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A form's draft, built with the shared builder. The draft is saved when the
// member says so, because the form engine refuses a draft with problems, so a
// half-built question could never be saved by itself. Publishing is a named
// action with a confirmation; a published version cannot change.

import { call } from '@pixel-scientists/domain/api';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import {
  Button,
  ErrorSummary,
  NotFoundPage,
  PageHeader,
  SaveStatus,
  Tabs,
  Tag,
  useLeaveGuard,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { SaveState } from '@pixel-scientists/ui';
import {
  ConfirmDialog,
  firstSelection,
  FormEditor,
  inWords,
  loweredProblems,
  placeOf,
  problemsOf,
  summaryOf,
} from '@pixel-scientists/ui/form-builder';
import type { Problem, Selection } from '@pixel-scientists/ui/form-builder';
import { useMemo, useRef, useState } from 'react';

import {
  formDefinitionInputSchema,
  getForm,
  getFormDraft,
  getFormVersion,
  listFormVersions,
  publishForm,
  saveFormDraft,
} from '../../contracts/index.ts';
import type { Form } from '../../contracts/index.ts';
import { FormsPage, LinkButton, orMissing, useParam } from '../Page.tsx';
import { FORMS_PATH, responsesPath, settingsPath } from '../paths.ts';
import { respondentWords, statusWords } from '../words.ts';
import { PreviewPanel } from './PreviewPanel.tsx';
import { publishRefusal } from './refusal.ts';

const NOT_A_FORM = 'This file is not a form. Choose a form file, then try again.';

const EMPTY: FormDefinition = { sections: [] };

/** The draft as the server will read it, or the problems that stop it, in the server's words. */
function check(definition: FormDefinition) {
  const result = formDefinitionInputSchema.safeParse(definition);
  return result.success
    ? { definition: result.data, problems: [] as Problem[] }
    : { definition: null, problems: problemsOf(result.error.issues) };
}

async function loadBuilder(formId: string) {
  const form = await orMissing(call(getForm, { params: { formId } }));
  if (form === null) return null;
  const [draft, { versions }] = await Promise.all([
    call(getFormDraft, { params: { formId } }),
    call(listFormVersions, { params: { formId } }),
  ]);
  const published = await Promise.all(
    versions.map(({ id }) => call(getFormVersion, { params: { formId, formVersionId: id } })),
  );
  return {
    form,
    draft,
    earlier: published.map(({ definition }) => definition),
    next: Math.max(0, ...versions.map(({ version }) => version)) + 1,
  };
}

type Built = NonNullable<Awaited<ReturnType<typeof loadBuilder>>>;

function Builder({ form: loaded, draft, earlier: first, next: firstNext }: Built) {
  const [form, setForm] = useState<Form>(loaded);
  const [earlier, setEarlier] = useState(first);
  const [next, setNext] = useState(firstNext);
  const start = draft.definition ?? EMPTY;
  const [definition, setDefinition] = useState(start);
  const [saved, setSaved] = useState(() => JSON.stringify(start));
  const [savedAt, setSavedAt] = useState(draft.updatedAt);
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const [selection, setSelection] = useState<Selection>(() => firstSelection(start));
  const [attempt, setAttempt] = useState(0);
  const [refused, setRefused] = useState<readonly Problem[]>([]);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [importProblem, setImportProblem] = useState<{ messages: string[]; count: number }>({
    messages: [],
    count: 0,
  });
  const running = useRef(false);

  const checked = useMemo(() => check(definition), [definition]);
  const lowered = useMemo(
    () => (checked.definition === null ? [] : loweredProblems(earlier, checked.definition)),
    [checked.definition, earlier],
  );
  const problems = [...checked.problems, ...lowered, ...refused];
  const dirty = JSON.stringify(definition) !== saved;
  useLeaveGuard(dirty);

  const edit = (changed: FormDefinition) => {
    setDefinition(changed);
    setRefused([]);
  };

  /** Shows what is wrong from the first problem, which is selected so its message is on the page. */
  function showProblems(found: readonly Problem[]) {
    setAttempt((count) => count + 1);
    const { section: s, field: f } = placeOf(found[0]?.path ?? []);
    const target = s === undefined ? undefined : definition.sections[s];
    if (target !== undefined) {
      setSelection({
        sectionId: target.id,
        fieldId: f === undefined ? null : (target.fields[f]?.id ?? null),
      });
    }
  }

  /** Saves the draft if it changed. Says whether the server has it now. */
  async function save(): Promise<boolean> {
    if (checked.definition === null) {
      showProblems(checked.problems);
      return false;
    }
    if (!dirty) return true;
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setState({ status: 'saving' });
    try {
      const sent = JSON.stringify(definition);
      const result = await call(saveFormDraft, {
        params: { formId: form.id },
        body: { definition: checked.definition },
      });
      setSaved(sent);
      setSavedAt(result.updatedAt);
      setState({ status: 'saved', at: new Date() });
      setAttempt(0);
      setRefused([]);
      return true;
    } catch {
      setState({ status: 'failed' });
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function startPublish() {
    if (!(await save())) return;
    if (lowered.length > 0) {
      showProblems(lowered);
      return;
    }
    setFailed([]);
    setAsking(true);
  }

  async function publish() {
    if (checked.definition === null) return;
    setBusy(true);
    try {
      const version = await call(publishForm, { params: { formId: form.id } });
      setEarlier([...earlier, version.definition]);
      setNext(version.version + 1);
      setForm({ ...form, status: 'published', latestVersion: version.version });
      setAsking(false);
      setAnnouncement(`Version ${String(version.version)} is published.`);
    } catch (error) {
      const found = publishRefusal(error, definition);
      setFailed(found.map(inWords));
      setRefused(found);
    } finally {
      setBusy(false);
    }
  }

  /** Closes the dialog. What a refused publish found goes on the page, where it can be fixed. */
  function close() {
    setAsking(false);
    if (refused.length > 0) showProblems(refused);
  }

  async function importFile(file: File) {
    let content: unknown;
    try {
      content = JSON.parse(await file.text());
    } catch {
      content = null;
    }
    const wrapped = (content as { definition?: unknown } | null)?.definition;
    const result = check((wrapped ?? content) as FormDefinition);
    if (result.definition === null) {
      setImportProblem(({ count }) => ({
        messages: result.problems.length > 0 ? result.problems.map(inWords) : [NOT_A_FORM],
        count: count + 1,
      }));
      return;
    }
    setImportProblem(({ count }) => ({ messages: [], count }));
    edit(result.definition);
    setSelection(firstSelection(result.definition));
    setAnnouncement('Form imported. Save the draft to keep it.');
  }

  const name = `version ${String(next)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Forms', to: FORMS_PATH }, { label: form.title }]}
        title={form.title}
        eyebrow={
          <Tag tone={form.status === 'published' ? 'success' : 'neutral'}>
            {statusWords[form.status]}
          </Tag>
        }
        description={
          form.latestVersion === null
            ? 'Not published yet. Nobody can answer until you publish it.'
            : `Version ${String(form.latestVersion)} is published. Publishing again makes ${name}.`
        }
        actions={
          <>
            <LinkButton to={settingsPath(form.id)}>Form settings</LinkButton>
            <LinkButton to={responsesPath(form.id)}>Responses</LinkButton>
            <Button id="save-draft" aria-disabled={busy || undefined} onClick={() => void save()}>
              Save draft
            </Button>
            <Button
              variant="primary"
              aria-disabled={busy || undefined}
              onClick={() => void startPublish()}
            >
              Publish form
            </Button>
          </>
        }
      />
      <SaveStatus state={state} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ErrorSummary
        key={`problems-${String(attempt)}`}
        errors={summaryOf(attempt > 0 ? problems : [], definition, selection)}
      />
      <ErrorSummary
        key={`import-${String(importProblem.count)}`}
        title="We could not import this file"
        errors={importProblem.messages.map((message) => ({ fieldId: 'import-file', message }))}
      />
      <Tabs
        label="Form views"
        tabs={[
          {
            id: 'edit',
            label: 'Edit form',
            content: (
              <FormEditor
                definition={definition}
                onChange={edit}
                selection={selection}
                onSelect={setSelection}
                problems={problems}
                showAll={attempt > 0}
                onImport={(file) => void importFile(file)}
              />
            ),
          },
          {
            id: 'preview',
            label: 'Preview',
            content: (
              <PreviewPanel
                formId={form.id}
                dirty={dirty}
                savedAt={savedAt}
                onSave={() => void save()}
              />
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={asking}
        title={`Publish ${name}?`}
        description={
          <>
            <span className="block">
              This publishes version {next}. A published version cannot be changed. To change the
              form later, you publish a new version.
            </span>
            <span className="mt-2 block">Who can answer: {respondentWords[form.respondents]}.</span>
          </>
        }
        confirm="Publish form"
        cancel="Keep editing"
        pending={busy}
        problems={failed}
        onConfirm={() => void publish()}
        onClose={close}
      />
    </>
  );
}

function Loader({ formId }: { formId: string }) {
  const { state, retry } = useLoad(loadBuilder, formId);
  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Form" />}
      <WhenLoaded state={state} label="Loading the form" retry={retry}>
        {(built) => (built === null ? <NotFoundPage /> : <Builder {...built} />)}
      </WhenLoaded>
    </>
  );
}

/** A form's draft to build, preview and publish. */
export default function BuilderPage() {
  return (
    <FormsPage>
      <Loader formId={useParam('formId')} />
    </FormsPage>
  );
}
