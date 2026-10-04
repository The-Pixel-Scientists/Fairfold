// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { HOW_APPLYING_WORKS_PATH } from '../paths.ts';

/** The address with no funder in it. Nobody can apply here, so it says what to open instead. */
export default function NoFunderPage() {
  return (
    <PageColumn>
      <PageIntro title="Use your funder's link">
        <p className="[overflow-wrap:anywhere]">
          To apply for a grant, open the link your funder gave you. It ends with the funder's name,
          like {window.location.host}/northfield.
        </p>
        <p>If you do not have the link, ask the funder to send it to you again.</p>
      </PageIntro>
      <div>
        <Link
          to={HOW_APPLYING_WORKS_PATH}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          Read how applying works
        </Link>
      </div>
    </PageColumn>
  );
}
