// SPDX-License-Identifier: AGPL-3.0-or-later

const ukTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `2027-01-20T15:20:00.000Z` as "20 January 2027, 3:20pm", in UK time. */
export function formatUkTime(iso: string): string {
  const part = new Map(ukTime.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const period = (part.get('dayPeriod') ?? '').toLowerCase();
  return `${part.get('day') ?? ''} ${part.get('month') ?? ''} ${part.get('year') ?? ''}, ${part.get('hour') ?? ''}:${part.get('minute') ?? ''}${period}`;
}
