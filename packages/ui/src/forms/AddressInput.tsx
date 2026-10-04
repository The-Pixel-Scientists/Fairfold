// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { FieldGroup } from '../FieldGroup.tsx';
import { FormField, Input } from '../FormField.tsx';

const PARTS = ['line1', 'line2', 'town', 'county', 'postcode'] as const;
type Part = (typeof PARTS)[number];
type Address = Record<Part, string>;

export interface AddressInputProps {
  /** The question, which names the group. */
  legend: ReactNode;
  /** The id of the first line; the other boxes add `-line2`, `-town`, `-county` and `-postcode`. */
  id: string;
  hint?: ReactNode;
  /** A problem with the address as a whole. */
  error?: ReactNode;
  /** A problem with one box. */
  partErrors?: Readonly<Partial<Record<Part, string>>>;
  /** A UK address, or null when nothing is entered. */
  value: unknown;
  onChange: (answer: Partial<Address> | null) => void;
}

const BOXES: readonly {
  part: Part;
  label: string;
  optional: boolean;
  autoComplete: string;
  width: string;
}[] = [
  {
    part: 'line1',
    label: 'Address line 1',
    optional: false,
    autoComplete: 'address-line1',
    width: '',
  },
  {
    part: 'line2',
    label: 'Address line 2',
    optional: true,
    autoComplete: 'address-line2',
    width: '',
  },
  {
    part: 'town',
    label: 'Town or city',
    optional: false,
    autoComplete: 'address-level2',
    width: 'max-w-xs',
  },
  {
    part: 'county',
    label: 'County',
    optional: true,
    autoComplete: 'address-level1',
    width: 'max-w-xs',
  },
  {
    part: 'postcode',
    label: 'Postcode',
    optional: false,
    autoComplete: 'postal-code',
    width: 'max-w-40',
  },
];

function partsOf(answer: unknown): Address {
  const given =
    typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
  const text = (part: Part) => (typeof given[part] === 'string' ? given[part] : '');
  return {
    line1: text('line1'),
    line2: text('line2'),
    town: text('town'),
    county: text('county'),
    postcode: text('postcode'),
  };
}

/** Nothing when every box is empty; otherwise the address, leaving out the optional boxes that are empty. */
function addressAnswer(address: Address): Partial<Address> | null {
  if (PARTS.every((part) => address[part] === '')) return null;
  const { line2, county, ...required } = address;
  return { ...required, ...(line2 === '' ? {} : { line2 }), ...(county === '' ? {} : { county }) };
}

/** A UK address as a labelled group of boxes, with the browser's autofill hints. */
export function AddressInput({
  legend,
  id,
  hint,
  error,
  partErrors = {},
  value,
  onChange,
}: AddressInputProps) {
  const address = partsOf(value);
  const partId = (part: Part) => (part === 'line1' ? id : `${id}-${part}`);

  return (
    <FieldGroup legend={legend} id={`${id}-address`} hint={hint} error={error}>
      <div className="flex flex-col gap-3">
        {BOXES.map(({ part, label, optional, autoComplete, width }) => (
          <FormField
            key={part}
            id={partId(part)}
            label={label}
            optional={optional}
            error={partErrors[part]}
          >
            <Input
              value={address[part]}
              autoComplete={autoComplete}
              className={width}
              onChange={(event) => {
                onChange(addressAnswer({ ...address, [part]: event.currentTarget.value }));
              }}
            />
          </FormField>
        ))}
      </div>
    </FieldGroup>
  );
}
