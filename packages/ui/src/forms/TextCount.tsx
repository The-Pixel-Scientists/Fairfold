// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { FormHelpers } from './types.ts';

/** A screen reader hears the count once typing stops, not at every key. */
const ANNOUNCE_AFTER_MS = 1000;

export interface TextCountProps {
  /** The id the answer is described by. */
  id: string;
  text: string;
  maxWords?: number | undefined;
  maxCharacters?: number | undefined;
  helpers: Pick<FormHelpers, 'countWords' | 'countCharacters'>;
}

interface Line {
  unit: 'word' | 'character';
  text: string;
  over: boolean;
}

function line(unit: 'word' | 'character', used: number, max: number): Line {
  const over = used > max;
  const difference = Math.abs(max - used);
  const plural = difference === 1 ? unit : `${unit}s`;
  return {
    unit,
    text: `You have ${difference.toLocaleString('en-GB')} ${plural} ${over ? 'too many' : 'left'}`,
    over,
  };
}

/**
 * How much of the limit an answer has left, as the person types: "You have 12
 * words left", or "You have 3 words too many" when it is over. The count
 * comes from the engine's own counter, so it matches the server's check. The
 * words, not only the colour, say when the answer is over.
 */
export function TextCount({ id, text, maxWords, maxCharacters, helpers }: TextCountProps) {
  const lines: Line[] = [];
  if (maxWords !== undefined) lines.push(line('word', helpers.countWords(text), maxWords));
  if (maxCharacters !== undefined) {
    lines.push(line('character', helpers.countCharacters(text), maxCharacters));
  }
  const spoken = lines.map((item) => item.text).join('. ');

  const [announced, setAnnounced] = useState(spoken);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnnounced(spoken);
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [spoken]);

  return (
    <>
      <div id={id} className="flex flex-col text-body">
        {lines.map((item) => (
          <span key={item.unit} className={item.over ? 'font-medium text-danger' : 'text-muted'}>
            {item.text}
          </span>
        ))}
      </div>
      <div role="status" className="sr-only">
        {announced}
      </div>
    </>
  );
}
