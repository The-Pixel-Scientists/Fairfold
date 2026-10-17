// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a file question adds to a question: the types of file it takes, the
// largest file and the most files. The platform's own limits are the top of
// the range; a form may only ask for less.

import {
  fileTypeLabels,
  fileTypes,
  MAX_FILE_BYTES,
  MAX_FILES_PER_FIELD,
} from '@pixel-scientists/domain/files';
import { CheckboxGroup, FormField, Select } from '@pixel-scientists/ui';

import type { FileQuestion } from './draft.ts';
import { Count, Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';
import { MB, sizeInWords } from './words.ts';

/** Each whole megabyte up to the platform's limit, in bytes. */
const sizes = Array.from({ length: MAX_FILE_BYTES / MB }, (_, index) => (index + 1) * MB);

export function FileSettings({
  question,
  errors,
  onChange,
}: {
  question: FileQuestion;
  errors: Errors;
  onChange: (question: FileQuestion) => void;
}) {
  // A form made elsewhere may ask for a size that is not a whole megabyte, which the list shows as it is.
  const choices = sizes.includes(question.maxBytes)
    ? sizes
    : [...sizes, question.maxBytes].sort((a, b) => a - b);
  return (
    <Settings heading="Files">
      <CheckboxGroup
        id="field-allowedTypes"
        legend="File types"
        name="allowedTypes"
        hint="Tick each type of file applicants can attach. Choose at least one."
        values={question.allowedTypes}
        onValuesChange={(ticked) => {
          onChange({
            ...question,
            allowedTypes: fileTypes.filter((type) => ticked.includes(type)),
          });
        }}
        options={fileTypes.map((type) => ({ value: type, label: fileTypeLabels[type] }))}
        error={errors.get('allowedTypes')}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField id="field-maxBytes" label="Largest file" error={errors.get('maxBytes')}>
          <Select
            value={String(question.maxBytes)}
            onChange={(event) => {
              onChange({ ...question, maxBytes: Number(event.currentTarget.value) });
            }}
          >
            {choices.map((bytes) => (
              <option key={bytes} value={bytes}>
                {sizeInWords(bytes)}
              </option>
            ))}
          </Select>
        </FormField>
        <Count
          id="field-maxFiles"
          label="Most files"
          value={question.maxFiles}
          max={MAX_FILES_PER_FIELD}
          error={errors.get('maxFiles')}
          onChange={(maxFiles) => {
            onChange({ ...question, maxFiles });
          }}
        />
      </div>
    </Settings>
  );
}
