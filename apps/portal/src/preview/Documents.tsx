// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of Section 5 of 6, the documents: three files, each at a different
// point, so the screen shows what ready, being checked and uploading look like.

import {
  Button,
  FileDrop,
  Meter,
  SaveStatus,
  SectionProgress,
  useNavigate,
} from '@pixel-scientists/ui';
import type { FileDropItem } from '@pixel-scientists/ui';
import { useState } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { documents, documentsSavedAt, fileRules } from './journey.ts';
import { ContactLine, ScreenHeader } from './parts.tsx';
import { caseOfficer, funder, round } from './story.ts';

type Files = Record<string, readonly FileDropItem[]>;

const initialFiles: Files = {
  accounts: [{ id: 'accounts', ...documents[0].file, status: 'ready' }],
  constitution: [{ id: 'constitution', ...documents[1].file, status: 'scanning' }],
  safeguarding: [{ id: 'safeguarding', ...documents[2].file, status: 'uploading', progress: 40 }],
};

export default function Documents() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<Files>(initialFiles);
  const ready = Object.values(files)
    .flat()
    .filter(({ status }) => status === 'ready').length;

  return (
    <PageColumn>
      <ScreenHeader
        title="Documents"
        eyebrow={`${round.programme}, ${round.name}`}
        breadcrumbs={[{ label: 'Your application', to: '/application' }, { label: 'Documents' }]}
        progress={<SectionProgress current={5} total={6} />}
      >
        <p>
          We need three documents. We check every file for viruses before anyone opens it, and you
          can carry on while we do.
        </p>
      </ScreenHeader>

      <Meter
        label="Documents ready"
        value={ready}
        max={documents.length}
        valueText={`${String(ready)} of ${String(documents.length)}`}
      />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          navigate('/application/check');
        }}
        className="flex flex-col gap-10"
      >
        {documents.map((document) => (
          <FileDrop
            key={document.id}
            label={document.label}
            hint={`${document.hint} ${fileRules}`}
            accept=".pdf,.doc,.docx"
            files={files[document.id] ?? []}
            onFilesChosen={([chosen]) => {
              if (chosen === undefined) return;
              const file: FileDropItem = {
                id: crypto.randomUUID(),
                name: chosen.name,
                size: chosen.size,
                status: 'scanning',
              };
              setFiles((current) => ({ ...current, [document.id]: [file] }));
            }}
            onRemove={(id) => {
              setFiles((current) => ({
                ...current,
                [document.id]: (current[document.id] ?? []).filter((file) => file.id !== id),
              }));
            }}
          />
        ))}

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <SaveStatus state={{ status: 'saved', at: documentsSavedAt }} />
            <p className="text-sm text-muted">
              Files are saved as soon as they upload. Do not have one of these? Contact{' '}
              {caseOfficer.name}: <ContactLine email={funder.email} phone={funder.phone} />.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              Save and continue
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                navigate('/application');
              }}
            >
              Save and come back later
            </Button>
          </div>
        </div>
      </form>
    </PageColumn>
  );
}
