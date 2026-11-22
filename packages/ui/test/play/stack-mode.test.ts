// @vitest-environment jsdom
/**
 * A modal spell on the live stack says which spell it is (CR 700.2).
 *
 * `mtg-dwlr`. `mtg-7si0` put the chosen mode in the recorded log and `mtg-sujc`
 * gave `../../src/board/StackZone.ts`'s `StackItem` a field of its own for it,
 * but only the replay's producer ever set that field. So the same card said
 * which mode was chosen when you watched the game back and said nothing while
 * you were playing it, which is the surface where the answer changes what you
 * do next: the object on the stack is the one you are deciding whether to
 * respond to.
 *
 * The state is reached through `reduce` rather than fabricated, for
 * `./stack.test.ts`'s reason: a stated stack is a position the kernel could not
 * have reached, and what is under test is that the projection reads what the
 * kernel actually holds. The mode is chosen by preferring the `mode: 1` cast
 * over `mode: 0`, so a producer that always printed the first mode fails rather
 * than passing on a coincidence -- the same thing
 * `../replay/modal-spell-replay.test.ts` does one layer over.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Mode } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { GameState } from '@mtg/kernel';
import { legalActions, reduce, scenario } from '@mtg/kernel';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';

const NAMES: SeatNames = ['You', 'Bot'];

const MODES: readonly Mode[] = [
  { effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }] },
  { effects: [{ kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } }] },
];

const ISLAND = basicLand('Island', 'XMP', 251);

const FORK: Card = parseCard({
  kind: 'sorcery',
  id: 'xmp-fork-in-the-path',
  name: 'Fork in the Path',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 42 },
  manaCost: { generic: 1 },
  colors: [],
  subtypes: [],
  supertypes: [],
  keywords: [],
  abilities: [],
  effects: [],
  modes: MODES,
});

/** The board with the second mode of `FORK` cast onto the stack by the viewer. */
function forkOnTheStack(mode: number): GameState {
  const state = scenario({
    battlefield: [
      { card: ISLAND, controller: 0 },
      { card: ISLAND, controller: 0 },
    ],
    hands: [[FORK], []],
  }).state;
  const cast = legalActions(state).find((action) => action.type === 'castSpell' && action.mode === mode);
  if (cast === undefined) throw new Error(`the fixture offers no cast at mode ${String(mode)}`);
  return reduce(state, cast).state;
}

function onlyEntry(state: GameState): { readonly modeLabel?: string } {
  const entries = boardPosition(state, 0, NAMES).stack.entries;
  const first = entries[0];
  if (first === undefined) throw new Error('nothing on the stack to read');
  return first;
}

describe('the live stack row over a modal spell', () => {
  it('says the chosen mode, not the first one the card prints', () => {
    expect(onlyEntry(forkOnTheStack(1)).modeLabel).toBe('You gain 5 life.');
  });

  it('says the other mode when that is the one that was cast', () => {
    expect(onlyEntry(forkOnTheStack(0)).modeLabel).toBe('Draw two cards.');
  });

  it('says nothing at all for a spell that prints no modes', () => {
    const state = scenario({
      battlefield: [{ card: ISLAND, controller: 0 }],
      hands: [[ISLAND], []],
    }).state;
    expect(boardPosition(state, 0, NAMES).stack.entries).toHaveLength(0);
  });
});
