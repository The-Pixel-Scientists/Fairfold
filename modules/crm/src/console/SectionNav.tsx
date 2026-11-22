// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useCan } from '@pixel-scientists/ui';

import { CRM_PATH, DUPLICATES_PATH, LISTS_PATH, SEGMENTS_PATH } from './paths.ts';

/** The crm section's pages, each only for members who may use it. */
export function SectionNav() {
  const duplicates = useCan('crm.duplicates.review');
  return (
    <nav aria-label="Records sections">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body">
        <li>
          <Link to={CRM_PATH}>Records</Link>
        </li>
        {duplicates && (
          <li>
            <Link to={DUPLICATES_PATH}>Possible duplicates</Link>
          </li>
        )}
        <li>
          <Link to={LISTS_PATH}>Lists</Link>
        </li>
        <li>
          <Link to={SEGMENTS_PATH}>Segments</Link>
        </li>
      </ul>
    </nav>
  );
}
