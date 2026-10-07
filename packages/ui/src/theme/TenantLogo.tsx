// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '../cx.ts';
import { tenantAsset } from './TenantTheme.tsx';

export interface TenantLogoProps {
  /** The funder's slug, from the address. */
  slug: string;
  /** The funder's name. It is the logo's alternative text, or the whole mark when there is no logo. */
  name: string;
  /** Whether the funder has uploaded a logo. */
  hasLogo: boolean;
  /** Change it after the funder changes its logo (see refreshTenantAssets), so the new image is drawn. */
  version?: number;
  className?: string;
}

/**
 * The funder's logo with its name as the alternative text, or the name alone
 * when it has no logo. The image is held to the height of a line of header
 * text, so a tall logo does not push the page about. On a dark page it sits
 * on a light chip, since most logos are drawn for a light background.
 */
export function TenantLogo({ slug, name, hasLogo, version = 0, className }: TenantLogoProps) {
  if (!hasLogo) return <span className={cx('font-medium text-ink', className)}>{name}</span>;
  return (
    <img
      key={version}
      src={tenantAsset(slug, 'logo')}
      alt={name}
      className={cx(
        'block h-8 w-auto max-w-48 object-contain object-left dark:rounded-sm dark:bg-ink dark:px-1.5 dark:py-0.5',
        className,
      )}
    />
  );
}
