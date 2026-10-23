// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse snapshot, fetched like any other request so a problem comes
// back in words, then offered to the browser as a file. The script stays in
// memory and goes nowhere else, so the page needs no new content security
// policy source.

import { apiBasePath, ProblemError, problemSchema } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';
import { getWarehouseSnapshot } from '@pixel-scientists/domain/warehouse';

/** The name of the file to save. */
export const snapshotFileName = (slug: string) => `${slug}-warehouse-snapshot.sql`;

/** The snapshot as a file, or a ProblemError saying why it could not be made. */
export async function fetchSnapshot(): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${apiBasePath}${getWarehouseSnapshot.path}`, {
      method: getWarehouseSnapshot.method,
      headers: { accept: 'application/sql' },
      credentials: 'same-origin',
      redirect: 'error',
    });
  } catch {
    throw new ProblemError(0, messages.noConnection);
  }
  if (!response.ok) {
    const problem = problemSchema.safeParse(await response.json().catch(() => undefined));
    if (problem.success) {
      throw new ProblemError(response.status, problem.data.detail, {
        requestId: problem.data.requestId,
      });
    }
    throw new ProblemError(
      response.status,
      response.status >= 500 ? messages.serviceFailed : messages.requestFailed,
    );
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('application/sql')) {
    throw new ProblemError(response.status, messages.serviceFailed);
  }
  return response.blob();
}

/** Offers a file to the browser to save. */
export function saveFile(name: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
