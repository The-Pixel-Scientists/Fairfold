// SPDX-License-Identifier: AGPL-3.0-or-later

import { listPasskeys } from '@pixel-scientists/domain/auth';
import { SummaryList, useSession } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { Screen } from '../auth/Screen.tsx';
import { homeCrumb, ReadPage } from '../party/parts.tsx';
import { useRead } from '../party/useRead.ts';

const TITLE = 'Your account';
const breadcrumbs = [homeCrumb, { label: TITLE }];
const readPasskeys = () => callApi(listPasskeys, {});

function Passkeys() {
  const { read, retry } = useRead(readPasskeys);
  return (
    <ReadPage title={TITLE} breadcrumbs={breadcrumbs} read={read} retry={retry}>
      {({ passkeys }) => <Details passkeyCount={passkeys.length} />}
    </ReadPage>
  );
}

function Details({ passkeyCount }: { passkeyCount: number }) {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  const { session } = state;
  const extra =
    session.mfa === 'complete'
      ? passkeyCount > 0
        ? `On. You have ${String(passkeyCount)} ${passkeyCount === 1 ? 'passkey' : 'passkeys'}.`
        : 'On. You use an authenticator app.'
      : 'Not set up. You can use the account without it.';
  return (
    <SummaryList
      items={[
        {
          term: 'Sign-in email address',
          value: <span className="[overflow-wrap:anywhere]">{session.user.email}</span>,
        },
        { term: 'Password', value: 'Set. We never show it.' },
        { term: 'Extra security (optional)', value: extra },
      ]}
    />
  );
}

/** What is set up on the applicant's account. Only a signed-in applicant reaches it. */
export default function AccountPage() {
  return (
    <Screen kind="applicant">
      <Passkeys />
    </Screen>
  );
}
