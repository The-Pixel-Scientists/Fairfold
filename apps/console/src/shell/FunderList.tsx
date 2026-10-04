// SPDX-License-Identifier: AGPL-3.0-or-later

import { switchTenant } from '@pixel-scientists/domain/auth';
import { slugSchema } from '@pixel-scientists/domain/platform';
import { Button, asProblem } from '@pixel-scientists/ui';
import type { SessionMembership } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../api.ts';
import { openFunder } from './openFunder.ts';

/**
 * One button for each funder the person can switch to. Switching asks the
 * API to change the session's active funder, then opens that funder's
 * address.
 */
export function FunderList({ memberships }: { memberships: readonly SessionMembership[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(membership: SessionMembership) {
    setPending(true);
    setError(null);
    try {
      await callApi(switchTenant, { body: { membershipId: membership.id } });
      const slug = slugSchema.safeParse(membership.tenant.slug);
      if (slug.success) openFunder(slug.data);
    } catch (problem) {
      setError(asProblem(problem)?.detail ?? 'Something went wrong. Try again.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {memberships.map((membership) => (
          <li key={membership.id}>
            <Button
              aria-disabled={pending || undefined}
              onClick={() => {
                if (!pending) void switchTo(membership);
              }}
            >
              Switch to {membership.tenant.name}
            </Button>
          </li>
        ))}
      </ul>
      {error !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
