// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One version of a round's form. A draft is built here: sections and
// questions in an outline, the settings of whichever is selected beside it,
// and a preview as applicants see it. The draft is saved when the manager
// says so, because the form engine refuses a draft with problems, so a
// half-built question could never be saved by itself. A published version is
// shown as applicants see it and cannot change.

import { call } from '@pixel-scientists/domain/api';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import {
  Button,
  EmptyState,
  ErrorSummary,
  PageHeader,
  Tabs,
  Tag,
  useLeaveGuard,
  useLoad,
  useNavigate,
  WhenLoaded,
} from '@pixel-scientists/ui';
import {
  ConfirmDialog,
  firstSelection,
  FormEditor,
  inWords,
  loweredProblems,
  placeOf,
  Preview,
  refusedProblems,
  summaryOf,
} from '@pixel-scientists/ui/form-builder';
import type { Problem, Selection } from '@pixel-scientists/ui/form-builder';
import { useEffect, useMemo, useRef, useState } from 'react';

import { discardFormDraft, publishFormDraft, saveFormDraft } from '../../contracts/index.ts';
import type { FormVersion, Programme, Round } from '../../contracts/index.ts';
import { formatMoment } from '../programme/format.ts';
import { LinkButton, ManagePage, useParam } from '../programme/Page.tsx';
import { formCrumbs } from './breadcrumbs.ts';
import { checkDefinition } from './check.ts';
import { readFormFile } from './formFile.ts';
import { loadVersion } from './loaders.ts';
import { formPath } from './paths.ts';
import { useHeadingFocus } from './useHeadingFocus.ts';

interface Page {
  version: FormVersion;
  round: Round;
  programme: Programme;
  /** The definitions of the form's published versions, which a draft may not classify lower than. */
  earlier: readonly FormDefinition[];
}

/** What the preview shows when the draft has problems: why, and where to fix them. */
function PreviewBlocked({ problems }: { problems: readonly Problem[] }) {
  return (
    <EmptyState title="Fix the problems to preview the form" headingLevel="h2">
      <p>The preview shows the form as it will be published. Go to Edit form to fix these:</p>
      <ul className="list-disc pl-5">
        {problems.map((problem) => (
          <li key={`${problem.path.join('.')}:${problem.message}`}>{inWords(problem)}</li>
        ))}
      </ul>
    </EmptyState>
  );
}

function DraftEditor({
  version,
  round,
  programme,
  earlier,
  onPublished,
}: Page & { onPublished: (version: FormVersion) => void }) {
  const navigate = useNavigate();
  useHeadingFocus();
  const start: FormDefinition = version.definition ?? { sections: [] };
  const [definition, setDefinition] = useState(start);
  const [saved, setSaved] = useState(() => JSON.stringify(start));
  const [savedAt, setSavedAt] = useState(version.updatedAt);
  const [selection, setSelection] = useState<Selection>(() => firstSelection(start));
  const [attempt, setAttempt] = useState(0);
  const [refused, setRefused] = useState<readonly Problem[]>([]);
  const [imported, setImported] = useState<{ attempt: number; messages: string[] }>({
    attempt: 0,
    messages: [],
  });
  const [asking, setAsking] = useState<'publish' | 'discard' | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const running = useRef(false);

  const checked = useMemo(() => checkDefinition(definition), [definition]);
  const lowered = useMemo(
    () => (checked.definition === null ? [] : loweredProblems(earlier, checked.definition)),
    [checked.definition, earlier],
  );
  const problems = [...checked.problems, ...lowered, ...refused];
  const dirty = JSON.stringify(definition) !== saved;
  useLeaveGuard(dirty && !leaving);

  // Leave once the guard has gone: it goes when the page draws again without it.
  useEffect(() => {
    if (leaving) navigate(formPath(round.id));
  }, [leaving, navigate, round.id]);

  const edit = (next: FormDefinition) => {
    setDefinition(next);
    setRefused([]);
  };
  /** Shows what is wrong, starting from the first problem, which is selected so its message is on the page. */
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

  /** Saves the draft if it has changed. Says whether it is saved now. */
  async function save(): Promise<boolean> {
    if (checked.definition === null) {
      showProblems(checked.problems);
      return false;
    }
    if (!dirty) return true;
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    try {
      const sent = JSON.stringify(definition);
      const result = await call(saveFormDraft, {
        params: { formVersionId: version.id },
        body: { definition: checked.definition },
      });
      setSaved(sent);
      setSavedAt(result.updatedAt);
      setAttempt(0);
      setRefused([]);
      return true;
    } catch (error) {
      const found = refusedProblems(error);
      setRefused(found);
      showProblems(found);
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
    setAsking('publish');
  }

  async function confirm() {
    setBusy(true);
    try {
      if (asking === 'publish') {
        onPublished(await call(publishFormDraft, { params: { formVersionId: version.id } }));
      } else {
        await call(discardFormDraft, { params: { formVersionId: version.id } });
        setAsking(null);
        setLeaving(true);
      }
    } catch (error) {
      const found = refusedProblems(error);
      setFailed(found.map(inWords));
      if (asking === 'publish') setRefused(found);
    } finally {
      setBusy(false);
    }
  }

  /** Closes the dialog. What a failed publish found goes on the page, where it can be fixed. */
  function close() {
    setAsking(null);
    if (failed.length > 0 && refused.length > 0) {
      showProblems(refused);
      setFailed([]);
    }
  }

  async function importFile(file: File) {
    const result = await readFormFile(file);
    if ('messages' in result) {
      setImported(({ attempt: count }) => ({ attempt: count + 1, messages: result.messages }));
      return;
    }
    setImported(({ attempt: count }) => ({ attempt: count, messages: [] }));
    edit(result.definition);
    setAnnouncement('Form imported. Save the draft to keep it.');
    setSelection(firstSelection(result.definition));
  }

  const name = `version ${String(version.version)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={formCrumbs(programme, round, `Version ${String(version.version)}`)}
        title="Application form"
        eyebrow={<Tag tone="neutral">Draft</Tag>}
        description={
          <>
            <span className="block font-medium text-ink">Version {version.version}, draft</span>
            <span role="status" className="block">
              {dirty
                ? 'You have changes that are not saved.'
                : `Saved ${formatMoment(savedAt, round.timeZone)}.`}
            </span>
          </>
        }
        actions={
          <>
            <Button
              variant="quiet"
              onClick={() => {
                setFailed([]);
                setAsking('discard');
              }}
            >
              Discard draft
            </Button>
            <Button id="save-draft" aria-disabled={busy || undefined} onClick={() => void save()}>
              Save draft
            </Button>
            <Button
              variant="primary"
              aria-disabled={busy || undefined}
              onClick={() => void startPublish()}
            >
              Publish {name}
            </Button>
          </>
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ErrorSummary
        key={`problems-${String(attempt)}`}
        errors={summaryOf(attempt > 0 ? problems : [], definition, selection)}
      />
      <ErrorSummary
        key={`import-${String(imported.attempt)}`}
        title="We could not import this file"
        errors={imported.messages.map((message) => ({ fieldId: 'import-file', message }))}
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
            content:
              checked.definition === null ? (
                <PreviewBlocked problems={checked.problems} />
              ) : (
                <Preview definition={checked.definition} />
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={asking === 'publish'}
        title={`Publish ${name}?`}
        description={`A published version cannot be changed. New applications use ${name} from now on, and applications already submitted keep the version they were submitted on. To change the form later, you start a new draft.`}
        confirm={`Publish ${name}`}
        cancel="Keep editing"
        pending={busy}
        problems={failed}
        onConfirm={() => void confirm()}
        onClose={close}
      />
      <ConfirmDialog
        open={asking === 'discard'}
        title="Discard this draft?"
        description="This deletes the draft and every change in it. Published versions are not affected."
        confirm="Discard draft"
        cancel="Keep draft"
        danger
        pending={busy}
        problems={failed}
        onConfirm={() => void confirm()}
        onClose={close}
      />
    </>
  );
}

/** A published version, as applicants see it. */
function PublishedView({ version, round, programme }: Page) {
  const by = version.publishedBy?.name ?? null;
  useHeadingFocus();

  return (
    <>
      <PageHeader
        breadcrumbs={formCrumbs(programme, round, `Version ${String(version.version)}`)}
        title="Application form"
        eyebrow={<Tag tone="success">Published</Tag>}
        description={
          <>
            <span className="block font-medium text-ink">
              Version {version.version}
              {version.publishedAt !== null &&
                `, published ${formatMoment(version.publishedAt, round.timeZone)}`}
              {by !== null && ` by ${by}`}
            </span>
            <span className="block">
              A published version cannot be changed. To make changes, create a draft from the
              versions of this form.
            </span>
          </>
        }
        actions={<LinkButton to={formPath(round.id)}>Back to versions</LinkButton>}
      />
      {version.definition !== null && <Preview definition={version.definition} />}
    </>
  );
}

function VersionPage({ version: loaded, round, programme, earlier }: Page) {
  const [version, setVersion] = useState(loaded);
  const [announcement, setAnnouncement] = useState('');
  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {version.status === 'draft' ? (
        <DraftEditor
          version={version}
          round={round}
          programme={programme}
          earlier={earlier}
          onPublished={(published) => {
            setAnnouncement(`Version ${String(published.version)} is published.`);
            setVersion(published);
          }}
        />
      ) : (
        <PublishedView version={version} round={round} programme={programme} earlier={earlier} />
      )}
    </>
  );
}

function Loader({ formVersionId }: { formVersionId: string }) {
  const { state, retry } = useLoad(loadVersion, formVersionId);
  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Application form" />}
      <WhenLoaded state={state} label="Loading the form" retry={retry}>
        {(page) => <VersionPage {...page} />}
      </WhenLoaded>
    </>
  );
}

/** A draft of a round's form to build, or a published version to read. */
export default function FormEditorPage() {
  return (
    <ManagePage title="Application form">
      <Loader formVersionId={useParam('formVersionId')} />
    </ManagePage>
  );
}
