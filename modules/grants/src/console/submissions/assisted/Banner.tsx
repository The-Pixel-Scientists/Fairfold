// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

export interface BannerProps {
  organisation: string;
  /** The applicant: the contact person named when the application started. */
  contact: string | null;
}

/** Whose application it is, in words, so nobody mistakes it for their own. */
export const bannerText = ({ organisation, contact }: BannerProps): string =>
  `You are filling in this application for ${organisation}${contact === null ? '' : ` on behalf of ${contact}`}. They will be told you submitted it.`;

/**
 * Shown at the top of every screen of the assisted journey, at every width.
 * It is not sticky: at 320px or 200% zoom it wraps to several lines, and a
 * sticky banner would cover the control that has focus. It is a polite live
 * region that is filled once the screen has opened, so it is read out once,
 * on entry.
 */
export function Banner(props: BannerProps) {
  const text = bannerText(props);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setAnnounced(text);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [text]);
  return (
    <div className="rounded-md border-2 border-warning bg-warning-soft p-3 text-body font-medium text-ink">
      <p role="status">{announced}</p>
    </div>
  );
}
