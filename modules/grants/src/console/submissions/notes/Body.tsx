// SPDX-License-Identifier: AGPL-3.0-or-later

/** A body as written: text only, never HTML or Markdown, wrapped at any width, with no links made. */
export function Body({ text }: { text: string }) {
  return <p className="text-body whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{text}</p>;
}
