// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prompt } from './Prompt.tsx';

/** What to do when an emailed link does not come, and where to ask for another. */
export function EmailNotArrived({ askAgainTo }: { askAgainTo: string }) {
  return (
    <>
      <section aria-labelledby="not-arrived" className="flex max-w-prose flex-col gap-3">
        <h2 id="not-arrived" className="text-xl font-semibold text-ink">
          If the email does not arrive
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6 text-body text-ink">
          <li>Look in your spam or junk folder.</li>
          <li>Check that you typed your email address correctly.</li>
          <li>
            Wait a few minutes. Then ask for a new link, with the same address or another one.
          </li>
        </ul>
      </section>
      <Prompt to={askAgainTo} link="Ask for a new link" />
    </>
  );
}
