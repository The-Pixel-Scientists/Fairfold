// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

/** Where the API serves a funder's public look. The apps' origin forwards `/api` to it (ADR 0004, ADR 0019). */
export function tenantAsset(slug: string, file: 'theme.css' | 'logo'): string {
  return `/api/public/tenants/${encodeURIComponent(slug)}/${file}`;
}

function sheets(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[data-tenant-theme]')];
}

function addSheet(href: string): HTMLLinkElement {
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = href;
  sheet.dataset['tenantTheme'] = '';
  document.head.append(sheet);
  return sheet;
}

export interface TenantThemeProps {
  /** The funder's slug, from the address. */
  slug: string;
  /** The preset the funder chose, such as `rounded`. It becomes `data-preset` on the page. */
  preset: string;
  /** Change it after the funder saves a new look (see refreshTenantAssets), so the new stylesheet is used at once. */
  version?: number;
}

/**
 * Applies a funder's look: its `theme.css`, added as a same-origin
 * stylesheet, so the page's content security policy is unchanged and no
 * inline style is written, and its preset on the page element. The
 * stylesheet only overrides the design tokens, so everything keeps its
 * contrast. It shows nothing itself.
 */
export function TenantTheme({ slug, preset, version = 0 }: TenantThemeProps) {
  useEffect(() => {
    addSheet(tenantAsset(slug, 'theme.css'));
    return () => {
      for (const sheet of sheets()) sheet.remove();
    };
  }, [slug]);

  // A browser will not read a stylesheet at the same address twice on one page, so a new look
  // arrives as a new sheet. The old ones go once it is in, so the page never shows the standard look in between.
  const first = useRef(version);
  useEffect(() => {
    if (version === first.current) return;
    const older = sheets();
    addSheet(tenantAsset(slug, 'theme.css')).addEventListener(
      'load',
      () => {
        for (const sheet of older) sheet.remove();
      },
      { once: true },
    );
  }, [slug, version]);

  useEffect(() => {
    const page = document.documentElement;
    page.dataset['preset'] = preset;
    return () => {
      delete page.dataset['preset'];
    };
  }, [preset]);

  return null;
}

/**
 * Reads a funder's stylesheet and logo again, past the browser's cache, which
 * may hold the old ones at the same address. Call it after the funder saves a
 * new look and before changing `version`. A read that fails is ignored: the
 * old look stays until the next page load.
 */
export async function refreshTenantAssets(slug: string): Promise<void> {
  const reload = (file: 'theme.css' | 'logo') =>
    fetch(tenantAsset(slug, file), { cache: 'reload', credentials: 'same-origin' }).catch(
      () => undefined,
    );
  await Promise.all([reload('theme.css'), reload('logo')]);
}
