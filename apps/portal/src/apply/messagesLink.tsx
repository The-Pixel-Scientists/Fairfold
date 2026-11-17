// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The way to the messages about an application, with how many are new for the
// applicant. The count is a courtesy: a page that cannot read it still shows
// the link.

import { getApplicantThread } from '@pixel-scientists/grants/contracts';
import { Link, Tag, buttonClassName } from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { callApi } from '../api.ts';
import { useRead } from '../party/useRead.ts';
import { messagesPath } from '../paths.ts';

export interface MessagesLinkProps {
  applicationId: string;
  /** Names the application for a screen reader, on a page that lists several. */
  of?: string;
  className?: string;
}

export function MessagesLink({ applicationId, of, className }: MessagesLinkProps) {
  const read = useCallback(async () => {
    try {
      const { unreadCount } = await callApi(getApplicantThread, { params: { applicationId } });
      return unreadCount;
    } catch {
      return 0;
    }
  }, [applicationId]);
  const { read: unread } = useRead(read);
  const count = unread.status === 'ready' ? unread.data : 0;

  // One label, so a screen reader reads "Messages, 2 new" with no stray pause.
  const label = `Messages${of === undefined ? '' : ` for ${of}`}${count > 0 ? `, ${String(count)} new` : ''}`;

  return (
    <Link
      to={messagesPath(applicationId)}
      aria-label={label}
      className={buttonClassName('secondary', className ?? 'w-full sm:w-auto')}
    >
      Messages
      {count > 0 && (
        <span className="ml-2">
          <Tag tone="info">{count} new</Tag>
        </span>
      )}
    </Link>
  );
}
