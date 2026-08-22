/** The play surface's scry choices, including groups with no cards in them. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Decision, GameState, ObjectId } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';

const NAMES: SeatNames = ['You', 'Bot'];

function sight(name: string, collectorNumber: number) {
  return parseCard({
    kind: 'creature',
    id: `play-scry-${String(collectorNumber)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 1 },
    colors: [],
    subtypes: ['Spirit'],
    power: 1,
    toughness: 1,
  });
}

const FIRST = sight('First Sight', 1);
const SECOND = sight('Second Sight', 2);

function scryState(cards: readonly (typeof FIRST)[]): GameState {
  return scenario({ libraries: [cards, []] }).state;
}

function oidAt(state: GameState, index: number): ObjectId {
  const oid = state.players[0].library[index];
  if (oid === undefined) throw new Error(`library has no card at ${String(index)}`);
  return oid;
}

function promptFor(
  state: GameState,
  cards: readonly ObjectId[],
  top: readonly ObjectId[],
  bottom: readonly ObjectId[],
) {
  const decision: Decision = {
    kind: 'scry',
    player: 0,
    cards,
    options: [{ type: 'scry', player: 0, top, bottom }],
    complete: true,
  };
  return buildPrompt(state, decision, NAMES);
}

describe('scry choice labels', () => {
  it('calls an empty bottom group nothing when every card stays on top', () => {
    const state = scryState([FIRST, SECOND]);
    const cards = [oidAt(state, 0), oidAt(state, 1)];

    expect(promptFor(state, cards, cards, []).choices[0]?.label).toBe(
      'Keep First Sight, Second Sight on top; put nothing on the bottom',
    );
  });

  it('calls an empty top group nothing when every card goes to the bottom', () => {
    const state = scryState([FIRST, SECOND]);
    const cards = [oidAt(state, 0), oidAt(state, 1)];

    expect(promptFor(state, cards, [], cards).choices[0]?.label).toBe(
      'Keep nothing on top; put First Sight, Second Sight on the bottom',
    );
  });

  it('calls both groups nothing when the library was empty', () => {
    const state = scryState([]);

    expect(promptFor(state, [], [], []).choices[0]?.label).toBe(
      'Keep nothing on top; put nothing on the bottom',
    );
  });
});
