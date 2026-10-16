// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createOrganisation,
  getMyOrganisation,
  identifierSchemeIds,
  identifierSchemes,
  legalForms,
  updateMyOrganisation,
} from '@pixel-scientists/party/contracts';
import type {
  IdentifierScheme,
  LegalForm,
  OrganisationInput,
  PortalOrganisation,
} from '@pixel-scientists/party/contracts';
import {
  Button,
  ErrorSummary,
  FieldGroup,
  FormField,
  Input,
  Select,
  useNavigate,
  useParams,
  useSubmit,
} from '@pixel-scientists/ui';
import type { UseSubmit } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef } from 'react';

import { callApi } from '../api.ts';
import { SubmitButton } from '../auth/fields.tsx';
import { Screen } from '../auth/Screen.tsx';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { ORGANISATIONS_PATH } from '../paths.ts';
import { useDraft } from './drafts.ts';
import { KeptNote, ReadPage, RestoredNotice, homeCrumb } from './parts.tsx';
import { savedPath } from './Saved.tsx';
import { useRead } from './useRead.ts';

interface Row {
  scheme: IdentifierScheme;
  identifier: string;
}

interface Values {
  name: string;
  /** Empty until chosen. */
  legalForm: string;
  identifiers: Row[];
  line1: string;
  line2: string;
  town: string;
  postcode: string;
  countryCode: string;
  website: string;
}

const blank: Values = {
  name: '',
  legalForm: '',
  identifiers: [],
  line1: '',
  line2: '',
  town: '',
  postcode: '',
  countryCode: 'GB',
  website: '',
};

function valuesOf(organisation: PortalOrganisation): Values {
  const { registeredAddress: address } = organisation;
  return {
    name: organisation.name,
    legalForm: organisation.legalForm,
    identifiers: organisation.identifiers,
    line1: address.line1,
    line2: address.line2 ?? '',
    town: address.town,
    postcode: address.postcode,
    countryCode: address.countryCode,
    website: organisation.website ?? '',
  };
}

/** The contract's input. An empty `legalForm` is refused by the contract, in its own words. */
function inputOf(values: Values): OrganisationInput {
  const { line1, line2, town, postcode, countryCode } = values;
  return {
    name: values.name,
    legalForm: values.legalForm as LegalForm,
    identifiers: values.identifiers,
    registeredAddress: { line1, line2, town, postcode, countryCode },
    website: values.website,
  };
}

/** Where an organisation can be registered. The contract takes any country; a full list needs its own data. */
const COUNTRIES = ['GB', 'IE', 'IM', 'JE', 'GG'];
const regionNames = new Intl.DisplayNames('en-GB', { type: 'region' });

function countryOptions(current: string): { code: string; name: string }[] {
  const codes = COUNTRIES.includes(current) ? COUNTRIES : [...COUNTRIES, current];
  return codes.map((code) => ({ code, name: regionNames.of(code) ?? code }));
}

/** The id and name of each text field: where its problem lies in the contract's input. */
const id = {
  name: 'name',
  legalForm: 'legalForm',
  line1: 'registeredAddress.line1',
  line2: 'registeredAddress.line2',
  town: 'registeredAddress.town',
  postcode: 'registeredAddress.postcode',
  countryCode: 'registeredAddress.countryCode',
  website: 'website',
} as const;

/** WebKit lets the chosen option's text run past a narrow select and widen the page; paint containment stops that. */
const CLIP = 'contain-paint';

const ADD_NUMBER_ID = 'add-number';
const schemeId = (index: number) => `identifiers.${String(index)}.scheme`;
const numberId = (index: number) => `identifiers.${String(index)}.identifier`;

/** Every field the form can show, in page order, so a problem with the whole form links to the first. */
function fieldsFor(rows: readonly Row[]): string[] {
  return [
    id.name,
    id.legalForm,
    ...rows.flatMap((_, index) => [schemeId(index), numberId(index)]),
    id.line1,
    id.line2,
    id.town,
    id.postcode,
    id.countryCode,
    id.website,
  ];
}

interface RowsProps {
  rows: readonly Row[];
  form: UseSubmit;
  onChange: (rows: Row[]) => void;
  /** Called with the id to focus once the page has drawn the change. */
  focusAfter: (id: string) => void;
}

/** The registration numbers: one type and number each, at most one of each type. */
function RegistrationNumbers({ rows, form, onChange, focusAfter }: RowsProps) {
  const used = new Set(rows.map((row) => row.scheme));
  const unused = identifierSchemeIds.find((scheme) => !used.has(scheme));
  const setRow = (index: number, row: Row) => {
    onChange(rows.map((old, at) => (at === index ? row : old)));
  };

  return (
    <FieldGroup
      legend="Registration numbers"
      hint="Add your charity or company number if you have one. If you do not, leave this empty."
    >
      <div className="flex flex-col gap-6">
        {rows.map((row, index) => (
          <FieldGroup key={index} legend={`Number ${String(index + 1)}`}>
            <div className="flex flex-col gap-5">
              <FormField
                id={schemeId(index)}
                label="Type of number"
                error={form.errorFor(schemeId(index))}
              >
                <Select
                  className={CLIP}
                  name={schemeId(index)}
                  value={row.scheme}
                  onChange={(event) => {
                    setRow(index, {
                      ...row,
                      scheme: event.currentTarget.value as IdentifierScheme,
                    });
                  }}
                >
                  {identifierSchemeIds
                    .filter((scheme) => scheme === row.scheme || !used.has(scheme))
                    .map((scheme) => (
                      <option key={scheme} value={scheme}>
                        {identifierSchemes[scheme].label}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField id={numberId(index)} label="Number" error={form.errorFor(numberId(index))}>
                <Input
                  name={numberId(index)}
                  autoComplete="off"
                  spellCheck={false}
                  value={row.identifier}
                  onChange={(event) => {
                    setRow(index, { ...row, identifier: event.currentTarget.value });
                  }}
                />
              </FormField>
              <div>
                <Button
                  variant="quiet"
                  onClick={() => {
                    focusAfter(ADD_NUMBER_ID);
                    onChange(rows.filter((_, at) => at !== index));
                  }}
                >
                  Remove <span className="sr-only">number {index + 1}</span>
                </Button>
              </div>
            </div>
          </FieldGroup>
        ))}
        {unused !== undefined && (
          <div>
            <Button
              id={ADD_NUMBER_ID}
              onClick={() => {
                focusAfter(schemeId(rows.length));
                onChange([...rows, { scheme: unused, identifier: '' }]);
              }}
            >
              {rows.length === 0 ? 'Add a charity or company number' : 'Add another number'}
            </Button>
          </div>
        )}
      </div>
    </FieldGroup>
  );
}

function OrganisationForm({
  organisationId,
  saved,
}: {
  /** Set to change an organisation; left out to add one. */
  organisationId?: string;
  saved: Values;
}) {
  const navigate = useNavigate();
  const adding = organisationId === undefined;
  const draft = useDraft(adding ? 'organisation' : `organisation:${organisationId}`, saved);
  const { values } = draft;

  const form = useSubmit(fieldsFor(values.identifiers), async () => {
    const body = inputOf(values);
    if (adding) await callApi(createOrganisation, { body });
    else await callApi(updateMyOrganisation, { params: { organisationId }, body });
    draft.discard();
    navigate(savedPath(ORGANISATIONS_PATH, adding ? 'organisation-added' : 'organisation-changed'));
  });

  // The row that was just added or removed takes focus once it has been drawn.
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    if (focusId.current === null) return;
    document.getElementById(focusId.current)?.focus();
    focusId.current = null;
  });

  const set = (field: keyof typeof id) => ({
    name: id[field],
    value: values[field],
    onChange: (event: { currentTarget: { value: string } }) => {
      draft.change({ ...values, [field]: event.currentTarget.value });
    },
  });

  return (
    <>
      {draft.restored && <RestoredNotice />}
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-8">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id={id.name} label="Organisation name" error={form.errorFor(id.name)}>
          <Input autoComplete="organization" {...set('name')} />
        </FormField>
        <FormField
          id={id.legalForm}
          label="Type of organisation"
          hint="Choose the closest match."
          error={form.errorFor(id.legalForm)}
        >
          <Select className={CLIP} {...set('legalForm')}>
            <option value="">Choose one</option>
            {Object.entries(legalForms).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        <RegistrationNumbers
          rows={values.identifiers}
          form={form}
          onChange={(identifiers) => {
            draft.change({ ...values, identifiers });
          }}
          focusAfter={(id) => {
            focusId.current = id;
          }}
        />
        <FieldGroup
          legend="Registered address"
          hint="The address your organisation is registered at. If it is not registered, use its main address."
        >
          <div className="flex flex-col gap-5">
            <FormField id={id.line1} label="Address line 1" error={form.errorFor(id.line1)}>
              <Input {...set('line1')} />
            </FormField>
            <FormField
              id={id.line2}
              label="Address line 2"
              optional
              error={form.errorFor(id.line2)}
            >
              <Input {...set('line2')} />
            </FormField>
            <FormField id={id.town} label="Town or city" error={form.errorFor(id.town)}>
              <Input className="max-w-xs" {...set('town')} />
            </FormField>
            <FormField id={id.postcode} label="Postcode" error={form.errorFor(id.postcode)}>
              <Input className="max-w-40" autoCapitalize="characters" {...set('postcode')} />
            </FormField>
            <FormField id={id.countryCode} label="Country" error={form.errorFor(id.countryCode)}>
              <Select className={CLIP} {...set('countryCode')}>
                {countryOptions(values.countryCode).map(({ code, name }) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </FieldGroup>
        <FormField
          id={id.website}
          label="Website"
          optional
          hint="Start with https://, like https://example.org."
          error={form.errorFor(id.website)}
        >
          <Input
            type="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            {...set('website')}
          />
        </FormField>
        <SubmitButton
          pending={form.pending}
          label={adding ? 'Add organisation' : 'Save changes'}
          pendingLabel="Saving…"
        />
        <KeptNote />
      </form>
    </>
  );
}

const crumbs = (title: string) => [
  homeCrumb,
  { label: 'Your organisations', to: ORGANISATIONS_PATH },
  { label: title },
];

function AddOrganisation() {
  const title = 'Add your organisation';
  return (
    <PageColumn>
      <PageIntro title={title} breadcrumbs={crumbs(title)}>
        <p>
          Tell us about the charity or group you are applying for. Have its address ready, and its
          charity or company number if it has one.
        </p>
      </PageIntro>
      <OrganisationForm saved={blank} />
    </PageColumn>
  );
}

function ChangeOrganisation({ organisationId }: { organisationId: string }) {
  const read = useCallback(
    () => callApi(getMyOrganisation, { params: { organisationId } }),
    [organisationId],
  );
  const { read: state, retry } = useRead(read);
  const title = 'Change organisation details';
  return (
    <ReadPage
      title={title}
      breadcrumbs={crumbs(title)}
      intro={<p>Change anything that is wrong, then save.</p>}
      read={state}
      retry={retry}
      missing={{
        text: 'We cannot find this organisation. It may belong to someone else.',
        to: ORGANISATIONS_PATH,
        link: 'Go to your organisations',
      }}
    >
      {(organisation) => (
        <OrganisationForm organisationId={organisationId} saved={valuesOf(organisation)} />
      )}
    </ReadPage>
  );
}

function Organisation() {
  const { organisationId } = useParams();
  return organisationId === undefined ? (
    <AddOrganisation />
  ) : (
    <ChangeOrganisation organisationId={organisationId} />
  );
}

/** Adds an organisation at `/organisations/new`, and changes one at `/organisations/:organisationId`. */
export default function OrganisationPage() {
  return (
    <Screen kind="applicant">
      <Organisation />
    </Screen>
  );
}
