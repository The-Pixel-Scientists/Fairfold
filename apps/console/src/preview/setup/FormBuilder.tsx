// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, buttonClassName, cx, Link, PageHeader, Tag } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { receivedSoFar, today } from './data.ts';
import {
  blankQuestion,
  conditions,
  formSections,
  formVersion,
  isNew,
  typeLabel,
} from './formData.ts';
import type { FormQuestion, FormSection } from './formData.ts';
import { QuestionEditor } from './QuestionEditor.tsx';
import { QuestionPreview } from './QuestionPreview.tsx';
import { formPreviewPath } from './routes.ts';

/** A button that selects one of a set, marked by a sheet behind it, heavier text and a bar at its start. */
const selectable = cx(
  'relative flex w-full text-start transition-colors duration-(--motion-fast) ease-standard hover:bg-sunken',
  'aria-[current=true]:bg-accent-soft aria-[current=true]:before:absolute aria-[current=true]:before:inset-y-2',
  "aria-[current=true]:before:left-0 aria-[current=true]:before:w-[3px] aria-[current=true]:before:rounded-full aria-[current=true]:before:bg-accent aria-[current=true]:before:content-['']",
);

function notesFor(question: FormQuestion): string {
  return [
    question.required ? 'Required' : 'Optional',
    conditions.find((item) => item.value === question.condition)?.note ?? '',
    question.visibility === 'staff' ? 'Hidden from reviewers' : '',
    question.visibility === 'totals' ? 'Totals only' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function SectionList({
  sections,
  currentId,
  onSelect,
}: {
  sections: readonly FormSection[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Sections</h2>
      <ul role="list" className="flex flex-wrap gap-1 xl:flex-col">
        {sections.map((section, index) => (
          <li key={section.id} className="xl:w-full">
            <button
              type="button"
              aria-current={section.id === currentId ? 'true' : undefined}
              onClick={() => {
                onSelect(section.id);
              }}
              className={cx(
                selectable,
                'min-h-control items-center justify-between gap-3 rounded-md px-3 text-body text-muted hover:text-ink aria-[current=true]:font-semibold aria-[current=true]:text-ink',
              )}
            >
              <span>
                <span className="tabular-nums">{index + 1}.</span> {section.title}
              </span>
              <span className="tabular-nums">
                {section.questions.length}
                <span className="sr-only"> questions</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="quiet" className="self-start">
        <PlusIcon />
        Add section
      </Button>
    </div>
  );
}

function QuestionList({
  section,
  currentId,
  edited,
  version,
  onSelect,
  onAdd,
}: {
  section: FormSection;
  currentId: string;
  edited: ReadonlySet<string>;
  version: number;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{section.title}</h2>
        <p className="text-body text-muted">{section.introduction}</p>
      </div>
      <ol role="list" className="flex flex-col divide-y divide-divider border-y border-divider">
        {section.questions.map((question, index) => (
          <li key={question.id}>
            <button
              type="button"
              aria-current={question.id === currentId ? 'true' : undefined}
              onClick={() => {
                onSelect(question.id);
              }}
              className={cx(selectable, 'gap-3 px-3 py-3')}
            >
              <span className="w-5 shrink-0 pt-0.5 text-sm text-muted tabular-nums">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-ink">{question.label}</span>
                    {edited.has(question.id) && (
                      <Tag tone="info">
                        Edited<span className="sr-only"> since version {version}</span>
                      </Tag>
                    )}
                  </span>
                  <span className="text-sm text-muted">{typeLabel(question)}</span>
                </span>
                <span className="text-sm text-muted">{notesFor(question)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Button className="self-start" onClick={onAdd}>
        <PlusIcon />
        Add question
      </Button>
    </div>
  );
}

/** Builds the application form: sections on the left, the questions of one in the middle, and the selected question's settings. */
export default function FormBuilder() {
  const [sections, setSections] = useState<readonly FormSection[]>(formSections);
  const [sectionId, setSectionId] = useState('budget');
  const [questionId, setQuestionId] = useState('budget');
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [version, setVersion] = useState(formVersion);
  const [announcement, setAnnouncement] = useState('');
  const focusQuestion = useRef(false);
  const newQuestions = useRef(0);

  useEffect(() => {
    if (!focusQuestion.current) return;
    focusQuestion.current = false;
    document.getElementById('question-label')?.focus();
  }, [questionId]);

  const section = sections.find((item) => item.id === sectionId) ?? sections[0];
  const index = section?.questions.findIndex((item) => item.id === questionId) ?? -1;
  const question = section?.questions[index];
  if (!section || !question) return null;
  const changes = edited.size;

  const changeQuestions = (
    update: (questions: readonly FormQuestion[]) => readonly FormQuestion[],
    editedId: string,
  ) => {
    setSections((current) =>
      current.map((item) =>
        item.id === section.id ? { ...item, questions: update(item.questions) } : item,
      ),
    );
    setEdited((current) => new Set(current).add(editedId));
  };

  const change = (patch: Partial<FormQuestion>) => {
    changeQuestions(
      (questions) =>
        questions.map((item) => (item.id === question.id ? { ...item, ...patch } : item)),
      question.id,
    );
  };

  const move = (by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= section.questions.length) return;
    changeQuestions((questions) => {
      const rest = questions.filter((item) => item.id !== question.id);
      rest.splice(target, 0, question);
      return rest;
    }, question.id);
    setAnnouncement(
      `${question.label} moved to position ${String(target + 1)} of ${String(section.questions.length)}`,
    );
  };

  const add = () => {
    newQuestions.current += 1;
    const blank = blankQuestion(`new-${String(newQuestions.current)}`);
    changeQuestions((questions) => [...questions, blank], blank.id);
    focusQuestion.current = true;
    setQuestionId(blank.id);
    setAnnouncement('Untitled question added');
  };

  const remove = () => {
    const next = section.questions[index + 1] ?? section.questions[index - 1];
    if (!next) return;
    setSections((current) =>
      current.map((item) =>
        item.id === section.id
          ? { ...item, questions: item.questions.filter((entry) => entry.id !== question.id) }
          : item,
      ),
    );
    setEdited((current) => {
      const rest = new Set(current);
      if (isNew(question.id)) rest.delete(question.id);
      else rest.add(question.id);
      return rest;
    });
    focusQuestion.current = true;
    setQuestionId(next.id);
    setAnnouncement(`${question.label} removed. ${next.label} is selected`);
  };

  const publish = () => {
    if (changes === 0) return;
    setVersion({ ...version, number: version.number + 1, published: today });
    setEdited(new Set());
    setAnnouncement(`Published as version ${String(version.number + 1)}`);
  };

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: '/programmes' },
          { label: 'Community Grants', to: '/programmes/community-grants' },
          { label: 'Spring 2027', to: '/programmes/community-grants/spring-2027' },
          { label: 'Form' },
        ]}
        eyebrow={<Tag tone="info">Design preview</Tag>}
        title="Form builder"
        description={
          <>
            <span className="block font-medium text-ink">
              Version {version.number}, published {version.published}
            </span>
            <span role="status" className="block text-pretty">
              {changes === 0
                ? `Nothing to publish. The ${String(receivedSoFar)} applications submitted so far keep the version they were submitted on.`
                : `${String(changes)} ${changes === 1 ? 'question' : 'questions'} changed since version ${String(version.number)}. Publishing makes version ${String(version.number + 1)}; submitted applications keep the version they were submitted on.`}
            </span>
            <span className="block">
              Rounds you create from Spring 2027 start from the latest version.
            </span>
          </>
        }
        actions={
          <>
            <Link to={formPreviewPath} target="_blank" className={buttonClassName()}>
              Preview form<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            <Button variant="primary" aria-disabled={changes === 0} onClick={publish}>
              Publish changes
            </Button>
          </>
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="grid items-start gap-x-6 gap-y-8 xl:grid-cols-[11.5rem_minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr]">
        <div className="xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <SectionList
            sections={sections}
            currentId={section.id}
            onSelect={(id) => {
              const first = sections.find((item) => item.id === id)?.questions[0];
              setSectionId(id);
              if (first) setQuestionId(first.id);
              setAnnouncement('');
            }}
          />
        </div>
        <div className="min-w-0 xl:col-start-2 xl:row-start-1">
          <QuestionList
            section={section}
            currentId={question.id}
            edited={edited}
            version={version.number}
            onSelect={(id) => {
              setQuestionId(id);
              setAnnouncement('');
            }}
            onAdd={add}
          />
        </div>
        <div className="max-w-2xl xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:max-w-none">
          <QuestionEditor
            question={question}
            index={index}
            length={section.questions.length}
            section={section.title}
            onChange={change}
            onMove={move}
            onRemove={remove}
          />
        </div>
        <div className="min-w-0 xl:col-start-2 xl:row-start-2">
          <QuestionPreview question={question} />
        </div>
      </div>
    </div>
  );
}
