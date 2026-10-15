// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

import { PageColumn, PageIntro } from '../PageColumn.tsx';

/**
 * The address names a funder the API does not know. Nothing else on the page
 * can work, so it says what is wrong and what to do. The page appears after
 * the funder was looked up, with no navigation to move focus, so it takes
 * focus itself.
 */
export default function UnknownFunderPage() {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    page.current?.querySelector('h1')?.focus();
  }, []);

  return (
    <div ref={page}>
      <PageColumn>
        <PageIntro title="We cannot find this funder">
          <p>Check the link you were given.</p>
          <p>If you do not have the link, ask the funder to send it to you again.</p>
        </PageIntro>
      </PageColumn>
    </div>
  );
}
