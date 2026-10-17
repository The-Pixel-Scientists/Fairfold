// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file question in the component gallery, wired to the real form engine
// and the real file checks as the portal will wire it. A pretend server stands
// in for the upload routes: it takes a few seconds to check a file, and the
// examples that hold a state keep it there. Development builds only.

import { ProblemError } from '@pixel-scientists/domain/api';
import { fileRefusalMessages, fileTypeLabels, sniffFileType } from '@pixel-scientists/domain/files';
import { checkFile, formDefinitionSchema, visibleFields } from '@pixel-scientists/domain/forms';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { AnswerView, FormSection } from '@pixel-scientists/ui';
import type { AttachedFile, FormFiles } from '@pixel-scientists/ui';
import { useState } from 'react';

import { helpers } from './FormExamples.tsx';

const fileHelpers = { ...helpers, fileTypeLabels, sniffFileType, checkFile };

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** How the pretend server answers an upload. */
type Behaviour = 'accepts' | 'stays uploading' | 'stays checking' | 'refuses';

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function pretendUpload(
  behaviour: Behaviour,
  fieldId: string,
  file: File,
  onProgress: (sent: number, total: number) => void,
): Promise<AttachedFile> {
  if (behaviour === 'stays uploading') {
    onProgress(45, 100);
    return new Promise(() => undefined);
  }
  if (behaviour === 'accepts') {
    for (const part of [0.25, 0.5, 0.75]) {
      onProgress(file.size * part, file.size);
      await wait(500);
    }
  }
  onProgress(file.size, file.size);
  if (behaviour === 'stays checking') return new Promise(() => undefined);
  if (behaviour === 'refuses') throw new ProblemError(400, fileRefusalMessages.infected);
  await wait(1500);
  const type = sniffFileType(new Uint8Array(await file.arrayBuffer()));
  return { id: crypto.randomUUID(), fieldId, name: file.name, type: type ?? PDF, bytes: file.size };
}

function fileQuestion(id: string, label: string, maxFiles: number) {
  return {
    id,
    type: 'file',
    label,
    hint: 'Signed by the trustees.',
    required: true,
    allowedTypes: [PDF, DOCX],
    maxFiles,
  };
}

function fileForm(...questions: ReturnType<typeof fileQuestion>[]): FormDefinition {
  return formDefinitionSchema.parse({
    sections: [
      { id: `s_${questions[0]?.id.slice(2) ?? 'files'}`, title: 'Documents', fields: questions },
    ],
  });
}

const attachedFile = (id: string, fieldId: string, name: string, bytes: number): AttachedFile => ({
  id,
  fieldId,
  name,
  type: PDF,
  bytes,
});

const accounts = (fieldId: string) =>
  attachedFile('accounts', fieldId, 'Accounts 2025 to 2026.pdf', 2_202_010);
const constitution = (fieldId: string) =>
  attachedFile('constitution', fieldId, 'Constitution.pdf', 856_064);
/** A name with nothing in it to break a line at. */
const report = (fieldId: string) =>
  attachedFile(
    'report',
    fieldId,
    'Northfield_Community_Trust_Annual_Report_and_Financial_Statements_2025-26.pdf',
    4_194_304,
  );

interface FileExampleProps {
  definition: FormDefinition;
  initial?: readonly AttachedFile[];
  behaviour?: Behaviour;
  readOnly?: boolean;
}

/** A form that keeps its files, as an apply journey will: a file joins the list when the upload ends. */
function FileExample({
  definition,
  initial = [],
  behaviour = 'accepts',
  readOnly = false,
}: FileExampleProps) {
  const [attached, setAttached] = useState(initial);
  const visible = visibleFields(definition, {});
  const files: FormFiles = {
    files: attached,
    readOnly,
    hrefFor: (id) => `#download-${id}`,
    onUpload: async (fieldId, file, onProgress) => {
      const added = await pretendUpload(behaviour, fieldId, file, onProgress);
      setAttached((current) => [...current, added]);
    },
    onRemove: (_fieldId, id) => {
      setAttached((current) => current.filter((file) => file.id !== id));
    },
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      {definition.sections.map((section) => (
        <FormSection
          key={section.id}
          section={section}
          visible={visible}
          answers={{}}
          onChange={() => undefined}
          helpers={fileHelpers}
          files={files}
          headingLevel="h3"
        />
      ))}
    </form>
  );
}

const emptyForm = fileForm(fileQuestion('f_fempty', 'Latest accounts', 3));
const uploadingForm = fileForm(fileQuestion('f_fup', 'Latest accounts', 3));
const checkingForm = fileForm(fileQuestion('f_fcheck', 'Latest accounts', 3));
const refusedForm = fileForm(fileQuestion('f_frefused', 'Latest accounts', 3));
const oneForm = fileForm(fileQuestion('f_fone', 'Latest accounts', 3));
const limitForm = fileForm(fileQuestion('f_flimit', 'Latest accounts', 2));
const readForm = fileForm(
  fileQuestion('f_fread', 'Latest accounts', 3),
  fileQuestion('f_freadmore', 'Safeguarding policy', 1),
);
const answerForm = fileForm(
  fileQuestion('f_fview', 'Latest accounts', 3),
  fileQuestion('f_fviewmore', 'Safeguarding policy', 1),
);

/** No files yet: choose some and watch each upload, the check for viruses, and the file join the list. */
export function EmptyFileExample() {
  return <FileExample definition={emptyForm} />;
}

/** A file part-way up: the labelled progress bar. The upload never ends, so the state stays. */
export function UploadingFileExample() {
  return <FileExample definition={uploadingForm} behaviour="stays uploading" />;
}

/** A file sent and being checked for viruses. The check never ends, so the state stays. */
export function CheckingFileExample() {
  return <FileExample definition={checkingForm} behaviour="stays checking" />;
}

/** The server refuses every file, as it does one with a virus: its words show beside the question and in the summary. */
export function RefusedFileExample() {
  return <FileExample definition={refusedForm} behaviour="refuses" />;
}

/** One file attached, with a link to download it and a button to remove it. */
export function OneFileExample() {
  return <FileExample definition={oneForm} initial={[accounts('f_fone')]} />;
}

/** A question that takes two files and has both: the way to add another gives way to words. */
export function LimitFileExample() {
  return (
    <FileExample definition={limitForm} initial={[report('f_flimit'), constitution('f_flimit')]} />
  );
}

/** Files that can be downloaded and no longer changed, and a question with none. */
export function ReadOnlyFileExample() {
  return <FileExample definition={readForm} initial={[accounts('f_fread')]} readOnly />;
}

/** A file answer as staff read it: links with type and size, and a question with no files. */
export function FileAnswerExample() {
  const visible = visibleFields(answerForm, {});
  return (
    <div className="max-w-prose">
      <AnswerView
        sections={answerForm.sections}
        visible={visible}
        answers={{ f_fview: ['accounts'] }}
        helpers={fileHelpers}
        files={[accounts('f_fview')]}
        hrefFor={(id) => `#download-${id}`}
        headingLevel="h3"
      />
    </div>
  );
}
