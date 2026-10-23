// SPDX-License-Identifier: AGPL-3.0-or-later

import { Notice, Panel, useCan, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { PublisherSetting } from '../../contracts/index.ts';
import { DownloadFile } from './DownloadFile.tsx';
import { loadPublisher } from './loaders.ts';
import { PublisherForm } from './PublisherForm.tsx';

const included = [
  'A grant identifier built from your prefix',
  "The round's title and the programme's summary",
  'The amount and the date it was awarded',
  "The recipient's name and identifier, with its charity or company number",
  'Your funder identifier and name, and the programme title',
];

const leftOut = [
  'Anything an applicant wrote',
  'Contact names, email addresses and phone numbers',
  'Scores, comments and notes',
  'Awards that have not been released',
];

function Points({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-divider pt-4">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Content({ initial }: { initial: PublisherSetting | null }) {
  const [saved, setSaved] = useState(initial);
  const canChoose = useCan('grants.programmes.manage');
  return (
    <>
      <p className="max-w-prose text-body text-ink">
        A file of your released awards in the 360Giving Data Standard, to publish so that others can
        see who you fund. Each download is recorded in the audit log.
      </p>
      <div className="grid gap-x-12 gap-y-4 md:grid-cols-2">
        <Points title="In the file" items={included} />
        <Points title="Left out" items={leftOut} />
      </div>
      <Step title="Publisher details">
        <p className="max-w-prose text-body text-muted">
          Every file prints these. They are public, so enter only what you want published.
        </p>
        <PublisherForm saved={saved} onSaved={setSaved} />
      </Step>
      <Step title="Download">
        {saved === null ? (
          <Notice tone="neutral" title="Save your publisher details first">
            The file prints them, so it cannot be made until they are saved.
          </Notice>
        ) : (
          <DownloadFile canChoose={canChoose} />
        )}
      </Step>
    </>
  );
}

/** The 360Giving part of the Data page: the funder's publisher details, and a file of released awards to save. */
export default function ThreeSixtyGivingSection() {
  const { state, retry } = useLoad(loadPublisher);
  return (
    <Panel title="360Giving file">
      <WhenLoaded state={state} label="Loading the 360Giving details" retry={retry}>
        {(publisher) => <Content initial={publisher} />}
      </WhenLoaded>
    </Panel>
  );
}
