// SPDX-License-Identifier: AGPL-3.0-or-later

import { requestSubjectAccess } from '@pixel-scientists/domain/platform/subject-access';
import {
  Button,
  EmptyState,
  Link,
  Notice,
  PageHeader,
  Panel,
  WhenLoaded,
  asProblem,
  buttonClassName,
  useCan,
  useLoad,
  useNavigate,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { useStepUp } from '../team/useStepUp.tsx';
import { NotFound, useIdParam } from './common.tsx';
import { loadPerson } from './person.ts';
import { SUBJECT_ACCESS_PATH, erasurePath, exportPath } from './paths.ts';

function Actions({ partyId, name }: { partyId: string; name: string }) {
  const canExport = useCan('platform.subject_access.request');
  const canErase = useCan('platform.erasure.request');
  const navigate = useNavigate();
  const stepUp = useStepUp();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function createExport() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      const accepted = await stepUp.run(() => callApi(requestSubjectAccess, { body: { partyId } }));
      if (accepted !== null) navigate(exportPath(accepted.requestId));
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'The export could not be requested. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {problem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
      {canExport && (
        <Panel title="Subject access export">
          <p className="max-w-prose text-body">
            The export holds everything your funder stores about {name} in every tool, including
            tools that are switched off, as one machine-readable JSON file.
          </p>
          <Notice tone="warning" title="Handle the file securely">
            <p>
              It may hold sensitive and special category data. Only you can download it, and it is
              deleted after 7 days.
            </p>
          </Notice>
          <div>
            <Button
              variant="primary"
              aria-disabled={pending || undefined}
              onClick={() => void createExport()}
            >
              Create subject access export
            </Button>
          </div>
        </Panel>
      )}
      {canErase && (
        <Panel title="Erasure">
          <p className="max-w-prose text-body">
            Erasing removes or anonymises {name}&apos;s personal data in every tool. You will check
            what happens before anything is erased.
          </p>
          <div>
            <Link to={erasurePath(partyId)} className={buttonClassName('danger')}>
              Erase personal data
            </Link>
          </div>
        </Panel>
      )}
      {stepUp.dialog}
    </>
  );
}

function Person({ partyId }: { partyId: string }) {
  const { state, retry } = useLoad(loadPerson, partyId);
  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <WhenLoaded state={state} label="Loading this person" retry={retry}>
        {(person) =>
          person.status === 'notFound' ? (
            <NotFound />
          ) : person.status === 'gone' ? (
            <EmptyState title="This person has no record to export or erase">
              <p>Their record is merged into another or already erased.</p>
              <Link to={SUBJECT_ACCESS_PATH} className={buttonClassName('primary')}>
                Find a person
              </Link>
            </EmptyState>
          ) : (
            <>
              <PageHeader
                title={person.name}
                breadcrumbs={[
                  { label: 'Subject access and erasure', to: SUBJECT_ACCESS_PATH },
                  { label: person.name },
                ]}
              />
              <SettingsSections />
              <Actions partyId={partyId} name={person.name} />
            </>
          )
        }
      </WhenLoaded>
    </div>
  );
}

/** One person: what an export holds, and the way to ask for one or to erase them. */
export default function PersonPage() {
  const partyId = useIdParam('partyId');
  return partyId === null ? <NotFound /> : <Person partyId={partyId} />;
}
