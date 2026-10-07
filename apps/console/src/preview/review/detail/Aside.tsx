// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, FormField, Link, Meter, Panel, SummaryList, Textarea } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import { charityNumber, criteria, pounds } from '../../story.ts';
import { mean, round1, rows } from '../data.ts';
import { budgetTotal, reference, requested } from '../featured.ts';
import type { Note } from '../featured.ts';
import { reviewScores } from '../scoring.ts';
import { NoteItem } from './NotesTab.tsx';

const item = rows.find((row) => row.reference === reference);
const reviews = item ? reviewScores(item) : [];
const score = item?.score ?? 0;

/** Facts staff look up often, the scores so far, and a place for internal notes. */
export function Aside({
  notes,
  onAddNote,
}: {
  notes: readonly Note[];
  onAddNote: (text: string) => void;
}) {
  const [text, setText] = useState('');

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (text.trim() === '') return;
    onAddNote(text.trim());
    setText('');
  }

  return (
    <aside aria-label="At a glance" className="flex min-w-0 flex-col gap-5">
      <Panel title="Key facts">
        <SummaryList
          items={[
            {
              term: 'Requested',
              value: (
                <>
                  <span className="font-semibold">{pounds(requested)}</span>
                  <span className="block text-sm text-muted">
                    of a {pounds(budgetTotal)} project
                  </span>
                </>
              ),
            },
            {
              term: 'Organisation',
              value: (
                <Link to="/organisations/northfield-community-trust">
                  Northfield Community Trust
                </Link>
              ),
            },
            { term: 'Charity number', value: charityNumber },
            {
              term: 'Contact',
              value: (
                <>
                  Sam Patel, project lead
                  <span className="block text-sm break-words text-muted">sam@example.org</span>
                  <span className="block text-sm text-muted">01632 960412</span>
                </>
              ),
            },
            { term: 'Submitted', value: '1 March 2027 at 2:14pm' },
            { term: 'Case officer', value: 'Ada Morgan' },
          ]}
        />
      </Panel>

      <Panel title="Scores so far">
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {score.toFixed(1)}
            </span>
            <span className="text-body text-muted">out of 5, weighted</span>
          </p>
          <p className="text-sm text-muted">
            {item?.reviews.submitted} of {item?.reviews.assigned} reviews submitted. The reviewers
            agree.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {criteria.map((criterion, index) => {
            const average = round1(mean(reviews.map((review) => review.scores[index] ?? 0)));
            return (
              <Meter
                key={criterion.id}
                label={criterion.label}
                value={average}
                min={0}
                max={5}
                valueText={`${average.toFixed(1)} of 5`}
              />
            );
          })}
        </div>
      </Panel>

      <Panel title="Internal notes">
        <p className="text-body text-muted">Applicants and reviewers never see these notes.</p>
        <ul className="flex flex-col divide-y divide-divider">
          {notes.slice(0, 2).map((note) => (
            <NoteItem key={`${note.when}:${note.text}`} note={note} />
          ))}
        </ul>
        {notes.length > 2 && (
          <p className="text-sm text-muted">
            {notes.length - 2} older {notes.length - 2 === 1 ? 'note is' : 'notes are'} in the Notes
            tab.
          </p>
        )}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormField label="Add a note">
            <Textarea
              rows={3}
              value={text}
              onChange={(event) => {
                setText(event.currentTarget.value);
              }}
            />
          </FormField>
          <div>
            <Button type="submit">Add note</Button>
          </div>
        </form>
      </Panel>
    </aside>
  );
}
