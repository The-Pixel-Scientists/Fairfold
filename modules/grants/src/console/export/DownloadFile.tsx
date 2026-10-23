// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  asProblem,
  buttonClassName,
  Button,
  FormField,
  Link,
  Notice,
  Select,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import type { ProgrammeList, ThreeSixtyGivingExport } from '../../contracts/index.ts';
import { loadProgrammes } from '../programme/loaders.ts';
import { PROGRAMMES_PATH } from '../programme/paths.ts';
import { loadExport } from './loaders.ts';
import { saveText } from './save.ts';
import { fileName, grantCount, scopesOf } from './scope.ts';
import type { Scope } from './scope.ts';

const UNEXPECTED = 'Something went wrong. Try again.';

type Made =
  | { kind: 'saved'; name: string; file: string; summary: ThreeSixtyGivingExport['summary'] }
  | { kind: 'none'; name: string };

type Result = Made | { kind: 'failed'; message: string };

/** What the file holds, in words, once it is made. */
function Outcome({ result }: { result: Made }) {
  if (result.kind === 'none') {
    return (
      <Notice tone="info" title={`${result.name} has no released awards yet`}>
        The file holds one grant for each award that has been released. Release decisions for a
        round, then download the file again.
      </Notice>
    );
  }
  const { unverifiedRecipients } = result.summary;
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="success" title={`Saved ${grantCount(result.summary.grants)} to ${result.file}`}>
        These are the released awards for {result.name}.
      </Notice>
      {unverifiedRecipients.length > 0 && (
        <Notice
          tone="warning"
          title={`${unverifiedRecipients.length.toLocaleString('en-GB')} ${
            unverifiedRecipients.length === 1 ? 'recipient has' : 'recipients have'
          } an identifier nobody has verified`}
        >
          <p>Check these before you publish the file.</p>
          <ul className="mt-1 list-disc ps-5">
            {unverifiedRecipients.map((recipient) => (
              <li key={recipient.id}>{recipient.name}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

function Chooser({ scopes }: { scopes: Scope[] }) {
  const [value, setValue] = useState(scopes[0]?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const scope = scopes.find((item) => item.value === value) ?? scopes[0];
  const programmes = [...new Set(scopes.map((item) => item.programme))];

  async function download() {
    if (busy || scope === undefined) return;
    setBusy(true);
    setResult(null);
    try {
      const { file, summary } = await loadExport(scope.query);
      if (summary.grants === 0) {
        setResult({ kind: 'none', name: scope.name });
      } else {
        const name = fileName(scope);
        saveText(name, JSON.stringify(file, null, 2), 'application/json');
        setResult({ kind: 'saved', name: scope.name, file: name, summary });
      }
    } catch (error) {
      setResult({ kind: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <FormField
          label="Awards to include"
          hint="Choose all of a programme's rounds, or one round."
          className="w-full max-w-md"
        >
          <Select
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setResult(null);
            }}
          >
            {programmes.map((programme) => (
              <optgroup key={programme} label={programme}>
                {scopes
                  .filter((item) => item.programme === programme)
                  .map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </FormField>
        <Button
          variant="primary"
          aria-disabled={busy || undefined}
          onClick={() => {
            void download();
          }}
        >
          Download 360Giving file
        </Button>
      </div>
      <div role="status" className="flex flex-col gap-3">
        {busy ? <p className="text-body text-muted">Making the 360Giving file</p> : null}
        {!busy && result !== null && result.kind !== 'failed' && <Outcome result={result} />}
      </div>
      {!busy && result?.kind === 'failed' && (
        <div role="alert">
          <Notice tone="danger" title="We could not make the file">
            {result.message}
          </Notice>
        </div>
      )}
    </div>
  );
}

function Programmes({ list }: { list: ProgrammeList }) {
  const scopes = scopesOf(list.programmes);
  if (scopes.length === 0) {
    return (
      <Notice
        tone="info"
        title="No programmes yet"
        action={
          <Link to={PROGRAMMES_PATH} className={buttonClassName()}>
            Go to programmes
          </Link>
        }
      >
        Create a programme, run a round and release its decisions. Then you can download its
        released awards here.
      </Notice>
    );
  }
  return <Chooser scopes={scopes} />;
}

function ChooseFromProgrammes() {
  const { state, retry } = useLoad(loadProgrammes);
  return (
    <WhenLoaded state={state} label="Loading programmes" retry={retry}>
      {(list) => <Programmes list={list} />}
    </WhenLoaded>
  );
}

export interface DownloadFileProps {
  /** Whether the person may list programmes, which choosing one needs. */
  canChoose: boolean;
}

/** Chooses a programme or round and saves its 360Giving file, with a summary of what it holds. */
export function DownloadFile({ canChoose }: DownloadFileProps) {
  if (!canChoose) {
    return (
      <Notice tone="neutral" icon="lock" title="You cannot choose a programme or round">
        Choosing what to download needs the programme manager role as well. Ask an administrator at
        your funder to add it.
      </Notice>
    );
  }
  return <ChooseFromProgrammes />;
}
