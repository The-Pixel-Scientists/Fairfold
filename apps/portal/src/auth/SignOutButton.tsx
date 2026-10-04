// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, useSession } from '@pixel-scientists/ui';
import { useState } from 'react';

/** "Sign out", and a message beside it when the service cannot be reached, which leaves the person signed in. */
export function SignOutButton({ primary = false }: { primary?: boolean }) {
  const { signOut } = useSession();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <Button
        variant={primary ? 'primary' : 'secondary'}
        className={primary ? 'w-full sm:w-auto' : undefined}
        onClick={() => {
          setFailed(false);
          signOut().catch(() => {
            setFailed(true);
          });
        }}
      >
        Sign out
      </Button>
      {failed && (
        <p role="alert" className="text-body font-medium text-danger">
          We could not sign you out. Check your connection and try again.
        </p>
      )}
    </>
  );
}
