// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, PageHeading, buttonClassName } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { RefObject } from 'react';

import { useFocusOnChange } from '../../auth/useFocusOnChange.ts';
import { useStepUp } from '../../platform/team/useStepUp.tsx';
import { useTenantSlug } from '../../tenant.ts';
import { AuthenticatorSection } from './AuthenticatorSection.tsx';
import { BackupCodesSection } from './BackupCodesSection.tsx';
import { EmailSection } from './EmailSection.tsx';
import { PasskeysSection } from './PasskeysSection.tsx';
import { PasswordSection } from './PasswordSection.tsx';

/**
 * A plain link, not the router's: the server has ended every session, so
 * the next page must load fresh and find nobody signed in.
 */
function SignedOutEverywhere({ heading }: { heading: RefObject<HTMLHeadingElement | null> }) {
  const slug = useTenantSlug();
  return (
    <>
      <PageHeading ref={heading}>You have been signed out</PageHeading>
      <p role="status" className="text-body">
        Your sign-in method has changed, so every session is signed out, including this one. Sign in
        again to carry on.
      </p>
      <div>
        <a href={`/${slug}/sign-in?notice=security-changed`} className={buttonClassName('primary')}>
          Sign in again
        </a>
      </div>
    </>
  );
}

export default function SecurityPage() {
  const stepUp = useStepUp();
  const [ended, setEnded] = useState(false);
  // The page is replaced in place, so focus has to follow to the new heading.
  const heading = useFocusOnChange<HTMLHeadingElement>(ended);

  if (ended) return <SignedOutEverywhere heading={heading} />;
  return (
    <>
      <PageHeader
        title="Account security"
        description="How you sign in, and the ways to get back in. Each change asks you to confirm it is you."
      />
      <div className="flex max-w-3xl flex-col gap-stack">
        <PasskeysSection stepUp={stepUp} />
        <AuthenticatorSection
          stepUp={stepUp}
          onSignedOut={() => {
            setEnded(true);
          }}
        />
        <BackupCodesSection stepUp={stepUp} />
        <EmailSection stepUp={stepUp} />
        <PasswordSection stepUp={stepUp} />
      </div>
      {stepUp.dialog}
    </>
  );
}
