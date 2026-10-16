// SPDX-License-Identifier: AGPL-3.0-or-later

import { legalForms, listMyOrganisations } from '@pixel-scientists/party/contracts';
import type { PortalOrganisationList } from '@pixel-scientists/party/contracts';
import { EmptyState, Link, buttonClassName } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { Screen } from '../auth/Screen.tsx';
import { ADD_ORGANISATION_PATH, organisationPath } from '../paths.ts';
import { ReadPage, homeCrumb } from './parts.tsx';
import { SavedNotice } from './Saved.tsx';
import { useRead } from './useRead.ts';

const TITLE = 'Your organisations';
const breadcrumbs = [homeCrumb, { label: TITLE }];

const readOrganisations = () => callApi(listMyOrganisations, {});

function Organisations({ organisations }: PortalOrganisationList) {
  if (organisations.length === 0) {
    return (
      <EmptyState
        title="No organisations yet"
        action={
          <Link to={ADD_ORGANISATION_PATH} className={buttonClassName('primary')}>
            Add your organisation
          </Link>
        }
      >
        <p>
          Add the organisation you want to apply for. You will need its address, and its charity
          number if it has one.
        </p>
      </EmptyState>
    );
  }
  return (
    <>
      <ul role="list" className="flex flex-col gap-4">
        {organisations.map(({ id, name, legalForm }) => (
          <li
            key={id}
            className="flex flex-col gap-4 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:flex-row sm:items-center sm:justify-between sm:p-6"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">
                {name}
              </h2>
              <p className="text-body text-muted">{legalForms[legalForm]}</p>
            </div>
            <Link
              to={organisationPath(id)}
              className={buttonClassName('secondary', 'w-full sm:w-auto')}
            >
              Change details <span className="sr-only">for {name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div>
        <Link
          to={ADD_ORGANISATION_PATH}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          Add another organisation
        </Link>
      </div>
    </>
  );
}

function List() {
  const { read, retry } = useRead(readOrganisations);
  return (
    <ReadPage
      title={TITLE}
      breadcrumbs={breadcrumbs}
      intro={
        <>
          <SavedNotice />
          <p>These are the charities and groups you can apply for.</p>
        </>
      }
      read={read}
      retry={retry}
    >
      {(list) => <Organisations {...list} />}
    </ReadPage>
  );
}

export default function OrganisationsPage() {
  return (
    <Screen kind="applicant">
      <List />
    </Screen>
  );
}
