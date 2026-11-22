// @vitest-environment jsdom
/**
 * Passing a main phase with an unplayed land drop says so.
 *
 * `mtg-re3`, from a real game: "Twice in one game I passed my main phase
 * holding a Swamp and a Mountain and lost the drop with no prompt, no color
 * change and no confirm." The enumeration was right the whole time, so what is
 * checked here is the sentence and the mark, and just as hard, that neither one
 * appears when the drop is gone.
 *
 * Two levels, on purpose. The derivation is checked against real kernel
 * enumerations, because the bug that can ship is a note that disagrees with the
 * move list beside it. The wiring is checked through a rendered table, because
 * the other bug that can ship is a correct string nothing draws.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { humanSeat, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { PlayView } from '../../src/routes/play/PlayView';
import { buildPrompt } from '../../src/routes/play/prompt';
import { LAND_DROP_LABEL, landDropNote, playableLands } from '../../src/routes/play/land-drop';
import { PASS_LABEL } from '../../src/routes/play/pass';

afterEach(cleanup);

const basics = setBasics(parseCards(EXAMPLE_CARDS));

function basicNamed(name: string): DslCard {
  const card = basics.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`no ${name} minted for the example cards`);
  return card;
}

const SWAMP = basicNamed('Swamp');
const MOUNTAIN = basicNamed('Mountain');
/** A precombat main with the named cards in the active seat's hand. */
function mainPhase(hand: readonly DslCard[]): GameState {
  return scenario({ seed: 'ui/land-drop', hands: [hand, []], active: 0, turn: 3 }).state;
}

function promptFor(state: GameState) {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the position asked nothing');
  return buildPrompt(state, decision, ['You', 'Bot']);
}

describe('what the enumeration says about the land drop', () => {
  it('counts the lands the kernel is offering to play', () => {
    expect(playableLands(promptFor(mainPhase([SWAMP, MOUNTAIN])))).toBe(2);
  });

  it('says nothing when the hand holds no land', () => {
    const state = mainPhase(
      parseCards(EXAMPLE_CARDS)
        .filter((card) => card.kind === 'creature')
        .slice(0, 2),
    );
    expect(playableLands(promptFor(state))).toBe(0);
    expect(landDropNote(promptFor(state))).toBeNull();
  });

  it('says nothing at a decision nobody is being asked at', () => {
    expect(playableLands(null)).toBe(0);
    expect(landDropNote(null)).toBeNull();
  });

  it('counts the drop once however many lands could take it', () => {
    // The note is about a window, not about a hand: one drop is spent whether
    // one land or four would have spent it, so the plural is a count of the
    // choices and never of the drops.
    expect(landDropNote(promptFor(mainPhase([SWAMP])))).toBe(
      'Land drop unspent, and a land in hand would take it',
    );
    expect(landDropNote(promptFor(mainPhase([SWAMP, MOUNTAIN])))).toBe(
      'Land drop unspent, and 2 lands in hand would take it',
    );
  });

  it('stops saying it the moment the drop is taken', () => {
    // Played rather than posed: the kernel's own per-turn counter is what ends
    // the window, and a scenario that put a land on the battlefield would have
    // built a position with the drop still unspent. So the drop is spent by
    // submitting the enumerated move, which is the same submission the button
    // above the note makes.
    const before = mainPhase([SWAMP, MOUNTAIN]);
    expect(playableLands(promptFor(before))).toBe(2);
    const decision = pendingDecision(before);
    if (decision === null) throw new Error('the position asked nothing');
    const play = decision.options.find((option) => option.type === 'playLand');
    if (play === undefined) throw new Error('no land was enumerated to play');
    const after = reduce(before, play).state;
    expect(playableLands(promptFor(after))).toBe(0);
    expect(landDropNote(promptFor(after))).toBeNull();
  });
});

function session(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function table(state: GameState): void {
  render(
    h(PlayView, {
      session: session(state),
      viewer: 0,
      names: ['You', 'Bot'],
      onChoose: () => undefined,
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      onYield: () => undefined,
    }),
  );
}

function passControl(): { readonly getAttribute: (name: string) => string | null } {
  return screen.getByRole('button', { name: PASS_LABEL }) as unknown as {
    readonly getAttribute: (name: string) => string | null;
  };
}

describe('what the table draws about it', () => {
  it('prints the sentence beside the pass and marks the button', () => {
    table(mainPhase([SWAMP, MOUNTAIN]));
    // Twice on purpose: the visible line beside the button, and the named live
    // region that announces it. A reader who cannot see the column gets the
    // same sentence, which is the half `mtg-re3` would otherwise have missed.
    const said = screen.getAllByText('Land drop unspent, and 2 lands in hand would take it');
    expect(said).toHaveLength(2);
    expect(screen.getByRole('status', { name: LAND_DROP_LABEL })).toBeDefined();
    expect(passControl().getAttribute('data-land-drop')).toBe('true');
  });

  it('leaves the pass unmarked and unexplained with no land in hand', () => {
    table(mainPhase([]));
    expect(screen.queryByText(/Land drop unspent/)).toBeNull();
    expect(passControl().getAttribute('data-land-drop')).toBeNull();
  });

  it('never disables the pass over it, because holding a land is a real move', () => {
    table(mainPhase([SWAMP]));
    expect(passControl().getAttribute('disabled')).toBeNull();
  });
});
