// SPDX-License-Identifier: AGPL-3.0-or-later

import { themeProperties } from '@pixel-scientists/domain/platform/settings';
import type { ThemeLook } from '@pixel-scientists/domain/platform/settings';
import { TenantLogo, buttonClassName, useColourScheme } from '@pixel-scientists/ui';
import type { ColourScheme } from '@pixel-scientists/ui';
import type { CSSProperties } from 'react';

import { useTenantLook } from './look.tsx';

/**
 * The custom properties `theme.css` would set for a look in a colour scheme,
 * from the same function the API uses, so the preview cannot drift from the
 * real thing. The dark block sits over the light one, as in `theme.css`, so
 * the corners come from the light block in both schemes. They are set on one
 * element through the browser's style object, not an inline style attribute
 * or a style element, so the content security policy stays as it is.
 */
function lookProperties(look: ThemeLook, scheme: ColourScheme): CSSProperties {
  try {
    const { light, dark } = themeProperties(look);
    return Object.fromEntries(scheme === 'dark' ? [...light, ...dark] : light);
  } catch {
    // A colour saved under older rules that no longer passes: the standard look shows until it is changed.
    return {};
  }
}

export interface LookPreviewProps {
  /** A preset look whose colour passes the contrast check, or tokens that pass every pair. */
  look: ThemeLook;
  slug: string;
  name: string;
  hasLogo: boolean;
  /** The scheme to show. Defaults to the one the page is in. */
  scheme?: ColourScheme;
}

/**
 * A header, a current page, buttons, a link and a form field in the chosen
 * look. It is a picture of the look, not controls: it is hidden from
 * assistive technology and nothing in it can be reached.
 */
export function LookPreview({ look, slug, name, hasLogo, scheme }: LookPreviewProps) {
  const { version } = useTenantLook();
  const pageScheme = useColourScheme();
  return (
    <div
      aria-hidden="true"
      inert
      style={lookProperties(look, scheme ?? pageScheme)}
      className="overflow-hidden rounded-lg border border-divider bg-canvas font-sans text-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-surface px-gutter py-2">
        <TenantLogo slug={slug} name={name} hasLogo={hasLogo} version={version} />
        <span className="rounded-md bg-accent-soft px-control-x py-1 text-body font-semibold text-accent underline decoration-2 underline-offset-4">
          Programmes
        </span>
      </div>
      <div className="flex flex-col gap-3 p-gutter">
        <div className="flex flex-col gap-field-gap">
          <span className="text-body font-medium text-ink">Programme name</span>
          <span className="text-body text-muted">The name applicants know.</span>
          <span className="flex min-h-control items-center rounded-md border border-edge bg-surface px-control-x text-body text-ink">
            Spring community grants
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={buttonClassName('primary')}>Save programme</span>
          <span className={buttonClassName('secondary')}>Cancel</span>
          <span className="text-body text-accent underline">View programme</span>
        </div>
      </div>
    </div>
  );
}
