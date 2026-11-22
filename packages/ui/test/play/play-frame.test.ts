// @vitest-environment jsdom
import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  OPPONENT_BOT_LABEL,
  OPPONENT_CHOICE_LABEL,
  OPPONENT_LAN_LABEL,
} from '../../src/routes/play/OpponentChoice';
import { PLAY_UNNAMED_SET, PlayLanding } from '../../src/routes/play/PlayLanding';
import { SOURCE_CHOICE_LABEL } from '../../src/routes/play/SourceChoice';
import { READY } from '../../src/routes/play/availability';
import type { PlayLandingProps } from '../../src/routes/play/PlayLanding';
import type { PlaySource } from '../../src/routes/play/sources';

const sources: readonly PlaySource[] = [
  { kind: 'kernel', stem: 'xmp', name: 'the flagship set', origin: 'custom' },
  { kind: 'printed', stem: 'printed:akh-hou', name: 'Amonkhet / Hour of Devastation' },
];

/**
 * A landing with every required prop and nothing optional, so a test that is
 * about the missing half says so by not asking for it: `exactOptionalPropertyTypes`
 * refuses `setName: undefined` as a way of spelling absent.
 */
function frame(over: Partial<PlayLandingProps> = {}): PlayLandingProps {
  return {
    setKind: 'kernel',
    format: 'draft',
    sources,
    selected: 'xmp',
    onSource: () => undefined,
    opponent: 'bot',
    onOpponent: () => undefined,
    facts: { lan: READY },
    playing: false,
    bot: h('p', null, 'The bot column'),
    lan: null,
    ...over,
  };
}

/** The text under a node, without the DOM lib (`./opponent-choice.test.ts`). */
function text(node: unknown): string {
  return (node as { readonly textContent: string | null }).textContent ?? '';
}

afterEach(cleanup);

const named = { setName: 'the flagship set', setLabel: 'Custom set' } as const;

it('names the set, offers the sets, offers the two opponents and draws the body', () => {
  render(h(PlayLanding, frame(named)));
  expect(screen.getByRole('heading', { level: 1, name: 'the flagship set' })).toBeTruthy();
  expect(screen.getByText('Custom set')).toBeTruthy();
  expect(screen.getByRole('group', { name: SOURCE_CHOICE_LABEL })).toBeTruthy();
  const opponents = screen.getByRole('group', { name: OPPONENT_CHOICE_LABEL });
  expect(text(opponents)).toContain(OPPONENT_BOT_LABEL);
  expect(text(opponents)).toContain(OPPONENT_LAN_LABEL);
  expect(screen.getByText('The bot column')).toBeTruthy();
});

it('says `This set` when it is handed a kind but no name', () => {
  render(h(PlayLanding, frame({ setLabel: 'Magic set' })));
  expect(text(screen.getByRole('heading', { level: 1, name: PLAY_UNNAMED_SET }))).toBe(PLAY_UNNAMED_SET);
});

it('draws no header at all when it knows neither the name nor the kind', () => {
  render(h(PlayLanding, frame()));
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
});

it('drops the header, the chips and the cells once a game is on, and keeps the body', () => {
  render(h(PlayLanding, frame({ ...named, playing: true })));
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  expect(screen.queryByRole('group', { name: SOURCE_CHOICE_LABEL })).toBeNull();
  expect(screen.queryByRole('button', { name: OPPONENT_BOT_LABEL })).toBeNull();
  expect(screen.queryByRole('button', { name: OPPONENT_LAN_LABEL })).toBeNull();
  expect(screen.getByText('The bot column')).toBeTruthy();
});
