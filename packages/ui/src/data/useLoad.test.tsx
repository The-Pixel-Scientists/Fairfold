// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useLoad, WhenLoaded } from './useLoad.tsx';

class Refused extends Error {
  readonly status = 503;
  readonly detail = 'The service is busy. Try again in a minute.';
  readonly errors = [];
}

function Example({ load, id }: { load: (id: string) => Promise<string>; id: string }) {
  const { state, retry } = useLoad(load, id);
  return (
    <WhenLoaded state={state} label="Loading the programme" retry={retry}>
      {(name) => <p>Programme {name}</p>}
    </WhenLoaded>
  );
}

describe('useLoad and WhenLoaded', () => {
  it('says what is loading, then shows the page', async () => {
    let finish: (name: string) => void = () => undefined;
    const load = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });
    render(<Example load={load} id="a" />);

    expect(screen.getByRole('status').textContent).toContain('Loading the programme');
    finish('Community Spaces Fund');

    expect(await screen.findByText('Programme Community Spaces Fund')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives the words of a failed call and reads again when asked', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const load = () => {
      reads += 1;
      return reads === 1 ? Promise.reject(new Refused()) : Promise.resolve('Spring round');
    };
    render(<Example load={load} id="a" />);

    expect(await screen.findByText('We could not load this page')).toBeTruthy();
    expect(screen.getByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Programme Spring round')).toBeTruthy();
    expect(reads).toBe(2);
  });

  it('gives a plain message for a failure that is not from the API', async () => {
    render(<Example load={() => Promise.reject(new TypeError('x is undefined'))} id="a" />);

    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('reads again when the key changes, with the new key', async () => {
    const asked: string[] = [];
    const load = (id: string) => {
      asked.push(id);
      return Promise.resolve(`number ${id}`);
    };
    const { rerender } = render(<Example load={load} id="1" />);
    await screen.findByText('Programme number 1');

    rerender(<Example load={load} id="2" />);

    expect(await screen.findByText('Programme number 2')).toBeTruthy();
    expect(asked).toEqual(['1', '2']);
  });
});
