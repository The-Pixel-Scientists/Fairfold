// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeading } from '@pixel-scientists/ui';

/** The address with no funder in it. Nobody can sign in here, so it says what to open instead. */
export default function NoFunderPage() {
  return (
    <div className="flex max-w-prose flex-col gap-stack">
      <PageHeading>Use your funder's link</PageHeading>
      <p className="text-body">
        To sign in to the console, open the link your funder gave you. It ends with your funder's
        name, like {window.location.host}/northfield.
      </p>
      <p className="text-body text-muted">
        If you do not have the link, ask the administrator at your funder.
      </p>
      {import.meta.env.DEV && (
        <p className="text-body">
          <Link to="/dev/components">Component gallery</Link> (development builds only)
        </p>
      )}
    </div>
  );
}
