// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Start application" asks which organisation is applying, then starts the
// application on the round's published form.

import { ProblemError } from '@pixel-scientists/domain/api';
import { getOpenRound, startApplication } from '@pixel-scientists/grants/contracts';
import type { OpenRoundDetail } from '@pixel-scientists/grants/contracts';
import { legalForms, listMyOrganisations } from '@pixel-scientists/party/contracts';
import type { PortalOrganisationList } from '@pixel-scientists/party/contracts';
import {
  EmptyState,
  ErrorSummary,
  Link,
  RadioGroup,
  buttonClassName,
  useNavigate,
  useParams,
  useSubmit,
} from '@pixel-scientists/ui';
import { useCallback, useState } from 'react';

import { callApi } from '../api.ts';
import { SubmitButton } from '../auth/fields.tsx';
import { homeCrumb } from '../party/parts.tsx';
import { useRead } from '../party/useRead.ts';
import {
  ADD_ORGANISATION_PATH,
  PROGRAMMES_PATH,
  applicationPath,
  programmePath,
} from '../paths.ts';
import { ApplyPage, ApplyScreen } from './parts.tsx';
import type { View } from './parts.tsx';

const FIELD = 'organisationId';
const CHOOSE = 'Choose the organisation that is applying.';
const TITLE = 'Who is applying?';

const programmes = { label: 'Programmes you can apply to', to: PROGRAMMES_PATH };

function StartForm({
  round,
  organisations,
}: {
  round: OpenRoundDetail;
  organisations: PortalOrganisationList['organisations'];
}) {
  const navigate = useNavigate();
  const [chosen, setChosen] = useState(
    organisations.length === 1 ? (organisations[0]?.id ?? '') : '',
  );
  const form = useSubmit([FIELD], async () => {
    if (chosen === '') {
      throw new ProblemError(400, CHOOSE, { errors: [{ field: FIELD, message: CHOOSE }] });
    }
    const application = await callApi(startApplication, {
      params: { roundId: round.id },
      body: { organisationId: chosen },
    });
    navigate(applicationPath(application.id));
  });

  if (organisations.length === 0) {
    return (
      <EmptyState
        title="Add your organisation first"
        action={
          <Link to={ADD_ORGANISATION_PATH} className={buttonClassName('primary')}>
            Add your organisation
          </Link>
        }
      >
        <p>
          Tell us about the charity or group you are applying for. You will need its address, and
          its charity number if it has one.
        </p>
      </EmptyState>
    );
  }
  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-8">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <RadioGroup
        id={FIELD}
        legend="Organisation"
        name={FIELD}
        hint="You cannot change this once you have started."
        value={chosen}
        onValueChange={setChosen}
        error={form.errorFor(FIELD)}
        options={organisations.map(({ id, name, legalForm }) => ({
          value: id,
          label: <span className="[overflow-wrap:anywhere]">{name}</span>,
          hint: legalForms[legalForm],
        }))}
      />
      <SubmitButton pending={form.pending} label="Start application" pendingLabel="Starting…" />
      <div>
        <Link to={ADD_ORGANISATION_PATH} className="inline-flex min-h-control items-center">
          Add another organisation
        </Link>
      </div>
    </form>
  );
}

function startView([round, { organisations }]: [OpenRoundDetail, PortalOrganisationList]): View {
  return {
    heading: {
      title: TITLE,
      breadcrumbs: [
        homeCrumb,
        programmes,
        { label: round.programme.title, to: programmePath(round.id) },
        { label: 'Start application' },
      ],
      intro: <p>Choose the organisation this application is for.</p>,
    },
    body: <StartForm round={round} organisations={organisations} />,
  };
}

function Start() {
  const { roundId = '' } = useParams();
  const read = useCallback(
    () =>
      Promise.all([
        callApi(getOpenRound, { params: { roundId } }),
        callApi(listMyOrganisations, {}),
      ]),
    [roundId],
  );
  const { read: state, retry } = useRead(read);
  return (
    <ApplyPage
      read={state}
      retry={retry}
      loading={{
        title: TITLE,
        breadcrumbs: [homeCrumb, programmes, { label: 'Start application' }],
      }}
      missing={{
        text: 'This programme is not taking applications. It may have closed.',
        to: PROGRAMMES_PATH,
        link: 'See programmes you can apply to',
      }}
      view={startView}
    />
  );
}

/** Which organisation is applying: `/programmes/:roundId/start`. */
export default function StartApplicationPage() {
  return (
    <ApplyScreen>
      <Start />
    </ApplyScreen>
  );
}
