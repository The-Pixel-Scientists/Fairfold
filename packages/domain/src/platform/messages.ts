// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every validation message, in the words of docs/CONTENT-STYLE.md: say what
// is wrong and how to fix it. The browser and the API both turn a Zod issue
// into words with messageForIssue(), so a person sees the same message
// whichever side caught the problem, at the same field. Neither ever
// repeats a submitted value or key.

/** One thing to fix, and where it is, such as `body.email` or `brandColour`. */
export interface FieldProblem {
  field: string;
  message: string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const messages = {
  // By kind of problem, for schemas without words of their own.
  enterText: 'Enter text.',
  enterNumber: 'Enter a number.',
  enterWholeNumber: 'Enter a whole number.',
  chooseTrueOrFalse: 'Choose true or false.',
  sendList: 'Send a list.',
  sendObject: 'Send an object.',
  enterExpectedType: 'Enter a value of the expected type.',
  tooSmall: 'This value is too small.',
  tooLarge: 'This value is too large.',
  atLeastCharacters: (count: number) => `Enter at least ${plural(count, 'character')}.`,
  atMostCharacters: (count: number) => `Enter no more than ${plural(count, 'character')}.`,
  atLeastItems: (count: number) => `Add at least ${plural(count, 'item')}.`,
  atMostItems: (count: number) => `Add no more than ${plural(count, 'item')}.`,
  atLeast: (limit: string) => `Enter ${limit} or more.`,
  moreThan: (limit: string) => `Enter more than ${limit}.`,
  atMost: (limit: string) => `Enter ${limit} or less.`,
  lessThan: (limit: string) => `Enter less than ${limit}.`,
  enterValidEmail: 'Enter a valid email address.',
  enterValidWebAddress: 'Enter a valid web address.',
  idNotValid: 'This id is not valid.',
  enterValidDate: 'Enter a valid date.',
  notExpectedFormat: 'This value is not in the expected format.',
  chooseAllowedValue: 'Choose one of the allowed values.',
  notValidMultiple: 'This number is not a valid multiple.',
  noAllowedFormat: 'This value does not match any allowed format.',
  fieldNotAccepted: 'This field is not accepted.',
  notValid: 'This value is not valid.',

  // Whole requests.
  fixFields: 'Some fields are not valid. Fix the fields listed and try again.',
  requestFailed: 'We could not complete the request. Try again.',
  serviceFailed: 'Something went wrong on our side. Try again in a few minutes.',
  noConnection: 'We could not reach the service. Check your connection and try again.',

  // Accounts and sign-in.
  email: 'Enter an email address in the correct format, like name@example.com.',
  emailTooLong: 'Enter an email address of 254 characters or fewer.',
  enterPassword: 'Enter your password.',
  passwordTooShort: 'Enter a password of at least 12 characters.',
  passwordTooLong: 'Enter a password of 256 characters or fewer.',
  totpCode: 'Enter the 6-digit code from your authenticator app.',
  linkNotValid: 'This link is not valid. Use the link in your latest email, or ask for a new one.',

  // Tenants, theme and logo.
  slugFormat:
    'Enter 3 to 40 lower case letters, numbers and single hyphens, starting with a letter.',
  slugReserved: 'This address is reserved. Choose another.',
  tenantNameHidden: 'Remove line breaks and hidden characters from the name.',
  tenantNameVisible: 'Enter a name that includes at least one letter or number.',
  brandColourFormat: 'Enter the colour as a hex code, like #1f4bb8.',
  brandColourContrast: (suggestion: string) =>
    `This colour is too light to read on the page or behind white text. Use ${suggestion} or a darker colour.`,
  logoType: 'Upload a PNG or WebP image.',
  logoTooLarge: 'Upload an image of 200 KB or less.',
  logoTooBig: 'Upload an image no larger than 1200 by 400 pixels.',
  logoAnimated: 'Upload a still image, not an animation.',
  logoUnreadable:
    'We could not read this image. Save it again as a PNG or WebP file and upload it.',

  // Team.
  chooseRole: 'Choose at least one role.',

  // Money.
  currency: 'Enter the amount in pounds.',
} as const;

/**
 * Marks a custom issue whose message this package wrote from the catalogue,
 * such as one built by a catalogue function:
 * `context.addIssue({ code: 'custom', message, params: catalogueParams })`.
 * Any other custom message is replaced, since it could repeat a value.
 */
export const catalogueParams = { catalogue: true } as const;

/** The fixed texts above. A message on this list is safe to show wherever it came from. */
const fixedTexts: ReadonlySet<string> = new Set(
  Object.values(messages as Record<string, unknown>).filter((value) => typeof value === 'string'),
);

const MAX_CUSTOM_MESSAGE_LENGTH = 200;

/**
 * A Zod issue as it is, or the API's validation entry rebuilt as one:
 * `{ code: entry.keyword, message: entry.message, path, ...entry.params }`.
 * A custom issue's own `params`, where `catalogueParams` sits, stays nested
 * under `params` in both.
 */
export interface IssueLike {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly path?: readonly PropertyKey[];
}

type IssueDetails = Readonly<Record<string, unknown>>;

function limitText(value: unknown): string | undefined {
  return typeof value === 'number' || typeof value === 'bigint' ? String(value) : undefined;
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined;
}

function typeMessage(expected: unknown): string {
  switch (expected) {
    case 'string':
      return messages.enterText;
    case 'number':
      return messages.enterNumber;
    case 'int':
      return messages.enterWholeNumber;
    case 'boolean':
      return messages.chooseTrueOrFalse;
    case 'array':
      return messages.sendList;
    case 'object':
      return messages.sendObject;
    default:
      return messages.enterExpectedType;
  }
}

function formatMessage(format: unknown): string {
  switch (format) {
    case 'email':
      return messages.enterValidEmail;
    case 'url':
      return messages.enterValidWebAddress;
    case 'uuid':
    case 'guid':
      return messages.idNotValid;
    case 'date':
    case 'datetime':
      return messages.enterValidDate;
    default:
      return messages.notExpectedFormat;
  }
}

function sizeMessage(issue: IssueDetails, small: boolean): string {
  const limit = small ? issue['minimum'] : issue['maximum'];
  const count = countOf(limit);
  const text = limitText(limit);
  if (count === undefined || text === undefined)
    return small ? messages.tooSmall : messages.tooLarge;
  if (issue['origin'] === 'string') {
    return small ? messages.atLeastCharacters(count) : messages.atMostCharacters(count);
  }
  if (issue['origin'] === 'array' || issue['origin'] === 'set') {
    return small ? messages.atLeastItems(count) : messages.atMostItems(count);
  }
  if (issue['inclusive'] === false)
    return small ? messages.moreThan(text) : messages.lessThan(text);
  return small ? messages.atLeast(text) : messages.atMost(text);
}

/**
 * Words for one Zod issue. A schema's own message is used when it is one of
 * the fixed texts above, or a custom issue marked with `catalogueParams`.
 * Otherwise the words come from the kind of issue, never from the value that
 * was sent.
 */
export function messageForIssue(issueLike: IssueLike): string {
  const issue = issueLike as IssueDetails;
  const own = issue['message'];
  if (typeof own === 'string' && fixedTexts.has(own)) return own;
  switch (issue['code']) {
    case 'invalid_type':
      return typeMessage(issue['expected']);
    case 'too_small':
      return sizeMessage(issue, true);
    case 'too_big':
      return sizeMessage(issue, false);
    case 'invalid_format':
      return formatMessage(issue['format']);
    case 'invalid_value':
      return messages.chooseAllowedValue;
    case 'not_multiple_of':
      return messages.notValidMultiple;
    case 'invalid_union':
      return messages.noAllowedFormat;
    case 'unrecognized_keys':
      return messages.fieldNotAccepted;
    case 'custom': {
      const params = issue['params'] as { catalogue?: unknown } | undefined;
      return typeof own === 'string' && own !== '' && params?.catalogue === true
        ? own.slice(0, MAX_CUSTOM_MESSAGE_LENGTH)
        : messages.notValid;
    }
    default:
      return messages.notValid;
  }
}

/** A path segment is a field id or a list position. Anything else could repeat a key that was sent. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
/** Names that reach an object's prototype if a caller indexes with the field name. */
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Where an issue is, such as `body.email` or `body.answers.f_0a1b`. An
 * invalid record key is left out, and any other segment that is not a plain
 * field id or position becomes `*`.
 */
export function fieldForIssue(location: string, issue: IssueLike): string {
  const path = issue.path ?? [];
  const segments = issue.code === 'invalid_key' ? path.slice(0, -1) : path;
  return [
    location,
    ...segments.map((segment) => {
      const text = typeof segment === 'symbol' ? '' : String(segment);
      return SAFE_SEGMENT.test(text) && !PROTOTYPE_KEYS.has(text) ? text : '*';
    }),
  ].join('.');
}
