// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Preset } from '@pixel-scientists/domain/platform';
import { themeProperties } from '@pixel-scientists/domain/platform/settings';
import { TenantLogo, buttonClassName, useColourScheme } from '@pixel-scientists/ui';
import type { ColourScheme } from '@pixel-scientists/ui';
import type { CSSProperties } from 'react';

import { useTenantLook } from './look.tsx';

/**
 * The custom properties `theme.css` would set for a look in the page's
 * colour scheme, from the same function the API uses, so the preview cannot
 * drift from the real thing. The dark block sits over the light one, as in
 * `theme.css`, so the corners come from the light block in both schemes. They
 * are set on one element through the
 * browser's style object, not an inline style attribute or a style element,
 * so the content security policy stays as it is.
 */
function lookProperties(brandColour: string, preset: Preset, scheme: ColourScheme): CSSProperties {
  try {
    const { light, dark } = themeProperties({ brandColour, preset });
    return Object.fromEntries(scheme === 'dark' ? [...light, ...dark] : light);
  } catch {
    // A colour saved under older rules that no longer passes: the standard look shows until it is changed.
    return {};
  }
}

export interface LookPreviewProps {
  /** A colour that passes the contrast check. */
  brandColour: string;
  preset: Preset;
  slug: string;
  name: string;
  hasLogo: boolean;
}

/**
 * A header, a current page, buttons and a link in the chosen look. It is a
 * picture of the look, not controls: it is hidden from assistive technology
 * and nothing in it can be reached.
 */
export function LookPreview({ brandColour, preset, slug, name, hasLogo }: LookPreviewProps) {
  const { version } = useTenantLook();
  const scheme = useColourScheme();
  return (
    <div
      aria-hidden="true"
      inert
      style={lookProperties(brandColour, preset, scheme)}
      className="overflow-hidden rounded-lg border border-divider bg-canvas text-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-surface px-gutter py-2">
        <TenantLogo slug={slug} name={name} hasLogo={hasLogo} version={version} />
        <span className="rounded-md bg-accent-soft px-control-x py-1 text-body font-semibold text-accent underline decoration-2 underline-offset-4">
          Programmes
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 p-gutter">
        <span className={buttonClassName('primary')}>Save programme</span>
        <span className={buttonClassName('secondary')}>Cancel</span>
        <span className="text-body text-accent underline">View programme</span>
      </div>
    </div>
  );
}
