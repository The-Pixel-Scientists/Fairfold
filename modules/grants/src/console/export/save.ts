// SPDX-License-Identifier: AGPL-3.0-or-later

/** Offers text to the browser as a file to save. The text stays in memory; nothing is sent anywhere. */
export function saveText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
