// SPDX-License-Identifier: AGPL-3.0-or-later

/** Why a request failed, in the server's words. Announced when it appears. */
export function Failure({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border-2 border-danger bg-danger-soft p-4">
      <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-danger">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
