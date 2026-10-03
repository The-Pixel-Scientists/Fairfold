// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RouteAnnouncerProps {
  /** The words to announce, for example "Navigated to Applications". */
  message: string;
  /**
   * Change this with each new announcement. The same words twice in a row
   * are then announced twice, because the text is a new element each time.
   */
  messageId?: number;
}

/**
 * A polite live region that tells screen reader users about a page change.
 * Router renders one; it is exported so another shell can place its own.
 */
export function RouteAnnouncer({ message, messageId = 0 }: RouteAnnouncerProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message !== '' && <span key={`${messageId}:${message}`}>{message}</span>}
    </div>
  );
}
