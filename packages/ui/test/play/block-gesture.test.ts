// @vitest-environment jsdom
/**
 * Blocking by clicking the cards, and the confirm boundary that ends it.
 *
 * `mtg-bz2.5`'s board half. the playtester, 2026-08-14, playing a real game: "it
 * felt really awkward to try to block an attacker", said in the same breath as
 * "I could click it and move it into the combat zone at least" about attacking.
 *
 * **What the board actually did before this file existed**, measured in
 * chromium at 1440x900 against a live view parked on a three-attacker,
 * four-blocker board (108 legal declarations): every eligible blocker was drawn
 * with the amber ring the rest of the table spends on "you may act on this", and
 * a click on one opened a picker of **72 whole declarations** — the flat list
 * `mtg-y1t` took out of the rail, still hanging off every card. On a board where
 * the creature had one legal block the same click **submitted the declaration
 * outright**, with no staging and no confirm, one turn step after an attack that
 * stages on the first click and commits only at a button. The rail was fixed and
 * the cards were left pointing at the old list.
 *
 * So the two halves this file holds are the two halves of that. The press goes
 * through the roster's own model rather than through the enumeration, and the
 * declaration ends at a button in the band where the attack's already does.
 *
 * The rail is untouched and stays the complete enumeration and the keyboard
 * path (`src/routes/play/rail.ts` holds that contract); `declare.test.ts` walks
 * every declaration through it and this file asserts the gesture submits the
 * identical `Choice`, so what a click records is what a roster press records and
 * `packages/kernel/test/block-enumeration.test.ts`'s replay proof covers both.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card, Keyword } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Decision, GameSession, GameState } from '@mtg/kernel';
import {
  DEFAULT_ENUMERATION_CAP,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { CLEAR_BLOCKS_LABEL, NO_BLOCK_CONFIRM_REASON } from '../../src/routes/play/combat';
import { blockGesture, declarationWords, NO_BLOCK_GESTURE } from '../../src/routes/play/declare';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const SEATS: SeatNames = ['Bot', 'You'];

let minted = 0;

/** A creature invented for this file, so no set's own card name is borrowed. */
function creature(name: string, keywords: readonly Keyword[] = []): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `blkg-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'BKG', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
    ...(keywords.length === 0 ? {} : { keywords }),
  });
}

/**
 * A board with `attackers` attacking and `blockers` untapped to answer them,
 * parked on the blocker declaration.
 *
 * Walked there through the kernel's own turn machinery and reduced with the
 * enumeration's own attack-with-everything option, then passed through CR
 * 508.2's priority, so every position asserted about is one the game could have
 * reached itself. Seat 0 attacks and seat 1 — the viewer everywhere below — is
 * the one being asked.
 */
function blockingState(attackers: readonly Card[], blockers: readonly Card[]): GameState {
  const built = scenario({
    seed: 'test/play/block-gesture',
    battlefield: [
      ...attackers.map((card) => ({ card, controller: 0 as const, summoningSick: false })),
      ...blockers.map((card) => ({ card, controller: 1 as const, summoningSick: false })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const decision = pendingDecision(built.state);
  if (decision === null || decision.kind !== 'declareAttackers') {
    throw new Error('the board never reached an attack declaration');
  }
  // Driven to the end of the declaration rather than reduced once: past the
  // enumeration cap the kernel asks about one creature at a time (`mtg-tb7v`,
  // `mtg-y16d`).
  let current = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before blockers were declared');
    if (pending.kind === 'declareBlockers') return current;
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

function sessionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): GameSession {
  const pending = pendingDecision(state, cap);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat(SEATS[0]), humanSeat(SEATS[1])],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function decisionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): Decision {
  const decision = pendingDecision(state, cap);
  if (decision === null) throw new Error('the board left nobody to ask');
  return decision;
}

interface Element {
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<Element>;
  querySelector(selector: string): Element | null;
  readonly textContent: string | null;
}

function root(): Element {
  const found = (globalThis as { document?: { body?: Element } }).document?.body;
  if (found === undefined) throw new Error('no document');
  return found;
}

function all(selector: string): readonly Element[] {
  return Array.from(root().querySelectorAll(selector));
}

/**
 * One card face on the table, by the name it publishes.
 *
 * The face is the only element carrying the card's own accessible name, and it
 * is a `button` exactly when something is wired to it (`src/card/Card.ts`), so
 * this is also the test for "is this card a control right now". Scoped to the
 * slot, because the hover zoom draws the same card a second time.
 */
function face(within_: string, name: string): Element {
  const found = all(`${within_} .mtg-slot > .mtg-card`).find(
    (node) => node.getAttribute('aria-label')?.startsWith(`${name}.`) === true,
  );
  if (found === undefined) throw new Error(`no card face named ${name} in ${within_}`);
  return found;
}

/**
 * Whether the ring landed inside the open question's answers.
 *
 * React focuses an `autoFocus` element as it mounts, and the answers mount
 * exactly when the question opens, so this reads the decision `selection.ts`
 * makes about where the ring goes rather than a scroll position or a class.
 */
function answersHoldTheRing(ask: string): boolean {
  const active = (globalThis as { document?: { activeElement?: Element | null } }).document?.activeElement;
  if (active === null || active === undefined) return false;
  const answers = all(`[role="group"][aria-label="${ask}"] button`);
  return answers.some((answer) => answer === active);
}

const MY_ROW = '.mtg-board__side[data-seat="you"] .mtg-board__spells';
const BAND = '.mtg-combat__entry';

/** One attribute off a node this file was handed rather than found; no DOM lib. */
function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function lit(node: Element): boolean {
  return node.getAttribute('data-interactive') === 'true';
}

function click(node: Element): void {
  fireEvent.click(node as unknown as Parameters<typeof fireEvent.click>[0]);
}

/** The band's own controls, which is where a declaration ends (`combat.ts`). */
function bandControls(): readonly Element[] {
  return all('.mtg-combat__controls button');
}

function bandControl(text: string): Element {
  const found = bandControls().find((node) => node.textContent?.startsWith(text) === true);
  if (found === undefined) {
    throw new Error(
      `no band control starting ${text}; had ${bandControls()
        .map((n) => n.textContent)
        .join(' | ')}`,
    );
  }
  return found;
}

/** The strip in order, as "name" for an attacker and "name>attacker" for a block. */
function strip(): readonly string[] {
  return all(BAND).map((entry) => {
    const name =
      entry.querySelector('.mtg-slot > .mtg-card')?.getAttribute('aria-label')?.split('.')[0] ?? '?';
    const blocks = entry.getAttribute('data-blocks');
    return blocks === null ? name : `${name}>${blocks}`;
  });
}

function keyOf(state: GameState, name: string): string {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no permanent named ${name}`);
  return found;
}

function draw(state: GameState, onChoose = vi.fn(), cap = DEFAULT_ENUMERATION_CAP): ReturnType<typeof vi.fn> {
  render(h(PlayView, { session: sessionOn(state, cap), viewer: 1, names: SEATS, onChoose }));
  return onChoose;
}

describe('the gesture the board offered before this lane', () => {
  it('no longer answers a press with the enumeration hanging off the card', () => {
    // Three attackers and four blockers: 108 legal declarations, and the press
    // that used to open 72 of them in a picker.
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover'), creature('Reed Skimmer', ['flying'])],
      [
        creature('Quarry Hound'),
        creature('Tin Lantern'),
        creature('Verge Harrier', ['flying']),
        creature('Palisade Outrider'),
      ],
    );
    // The board the measurement was taken on: 108 legal declarations, of which
    // one card's press used to offer 72. CR 509.1a lets each blocker sit out or
    // take any one attacker it is able to block, independently, so the space is
    // the product of the four rows: three ground blockers with three answers
    // each (out, Ember Courser, Salt Marsh Drover) and the flier with four,
    // because CR 509.1b lets it answer Reed Skimmer as well.
    const space = 3 * 3 * 4 * 3;
    expect(space).toBe(108);
    expect(decisionOn(state, space).options).toHaveLength(space);
    const onChoose = draw(state, vi.fn(), space);

    click(face(MY_ROW, 'Quarry Hound'));

    // Nothing was submitted and no menu of declarations was opened. Both halves
    // matter: the old behavior was one or the other depending on how many
    // options happened to name the creature.
    expect(onChoose).not.toHaveBeenCalled();
    expect(all('.mtg-picker')).toHaveLength(0);
  });

  it('opens the question on the card and lights exactly the attackers that answer it', () => {
    // Two attackers this creature may block and one it may not, so the press is
    // a question rather than a toggle and the answer list is a real subset.
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover'), creature('Reed Skimmer', ['flying'])],
      [creature('Quarry Hound'), creature('Tin Lantern')],
    );
    draw(state);
    click(face(MY_ROW, 'Quarry Hound'));

    // The creature being asked about is selected — a different channel from the
    // amber every pressable creature already wears, because both are true of it.
    expect(face(MY_ROW, 'Quarry Hound').getAttribute('data-selected')).toBe('true');
    expect(face(MY_ROW, 'Tin Lantern').getAttribute('data-selected')).toBe('false');

    // A ground creature may not block a flyer (CR 509.1b), so that attacker is
    // not a control at all rather than a control that refuses. The kernel's own
    // per-creature statement decides it; nothing here re-derives legality.
    expect(lit(face(BAND, 'Ember Courser'))).toBe(true);
    expect(lit(face(BAND, 'Reed Skimmer'))).toBe(false);
  });

  it('assigns on the second press and pairs the two cards in the seam', () => {
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover')],
      [creature('Quarry Hound'), creature('Palisade Outrider')],
    );
    const onChoose = draw(state);
    const courser = keyOf(state, 'Ember Courser');

    click(face(MY_ROW, 'Quarry Hound'));
    click(face(BAND, 'Ember Courser'));

    // The blocker left the row and stands next to what it answers, which is the
    // whole of the drawing (`src/board/CombatZone.ts`).
    expect(strip()).toEqual(['Ember Courser', `Quarry Hound>${courser}`, 'Salt Marsh Drover']);
    // A second blocker on the same attacker lands beside the first, and the
    // attackers keep the order the board is in.
    click(face(MY_ROW, 'Palisade Outrider'));
    click(face(BAND, 'Ember Courser'));
    expect(strip()).toEqual([
      'Ember Courser',
      `Quarry Hound>${courser}`,
      `Palisade Outrider>${courser}`,
      'Salt Marsh Drover',
    ]);

    // Four presses and the kernel has still heard nothing. Seed plus `choices`
    // is the entire record, so a replay cannot tell this from a player who
    // pressed nothing until the confirm.
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('says what a staged block is to a reader who cannot see where the card went', () => {
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    draw(state);
    click(face(MY_ROW, 'Quarry Hound'));

    // Adjacency is invisible to a screen reader, exactly as the attacker's own
    // move into the band is, so the mark carries the sentence — including that
    // it has not been declared, which is the difference the gesture is for.
    const mark = all('.mtg-mark[data-mark="staged-block"]')[0];
    expect(mark?.getAttribute('aria-label')).toBe("Assigned to block Bot's Ember Courser; not declared yet.");
  });
});

describe('the confirm boundary', () => {
  it('ends the declaration in the band, submitting what the roster would submit', () => {
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    const decision = decisionOn(state);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    const onChoose = draw(state);

    click(face(MY_ROW, 'Quarry Hound'));
    click(bandControl('Block with 1 creature'));

    expect(onChoose).toHaveBeenCalledTimes(1);
    const submitted: unknown = onChoose.mock.calls[0]?.[0];
    // An index into the enumeration, which is what an ordinary board has always
    // recorded, and the index of exactly this block rather than a neighbor.
    expect(typeof submitted).toBe('number');
    const option = decision.options[submitted as number];
    if (option === undefined || option.type !== 'declareBlockers') throw new Error('no such option');
    expect(option.blocks).toEqual([
      { blocker: keyOf(state, 'Quarry Hound'), attacker: keyOf(state, 'Ember Courser') },
    ]);
  });

  it('offers a real declaration of nothing before anything is assigned', () => {
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    const onChoose = draw(state);
    // The commonest answer at a blocker prompt, and it is in the band as well as
    // at the head of the rail: a player who has been looking at the cards should
    // not have to cross the table to say no.
    expect(bandControls().map((node) => node.textContent)).toEqual([
      declarationWords('declareBlockers').confirm(0),
    ]);
    click(bandControl('No blocks'));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('refuses a half-built menace block, and leaves every way out open', () => {
    // CR 702.110b: a creature with menace cannot be blocked by one creature, so
    // a player on the way to a legal two-creature block stands on a declaration
    // the kernel would not take. That is a position, not an error.
    const state = blockingState(
      [creature('Bramble Stalker', ['menace'])],
      [creature('Quarry Hound'), creature('Palisade Outrider'), creature('Tin Lantern')],
    );
    // The claim is about a declaration the *listed* enumeration refuses, so the
    // decision has to be the flat list rather than a question asked one creature
    // at a time: a stepwise declaration takes one blocker as a settled step and
    // the confirm is live, which is a different position and not this one. Three
    // blockers against one attacker is 2^3 before CR 702.110b removes the three
    // single-blocker declarations, so the width the fixture needs is eight.
    const onChoose = draw(state, vi.fn(), 2 ** 3);

    click(face(MY_ROW, 'Quarry Hound'));
    const confirm = bandControl('Block with 1 creature');
    expect(confirm.getAttribute('disabled')).not.toBeNull();
    expect(confirm.getAttribute('title')).toBe(NO_BLOCK_CONFIRM_REASON);
    // Escapable and completable: every creature is still a control, and the way
    // out with one press is beside the refused confirm.
    expect(lit(face(MY_ROW, 'Palisade Outrider'))).toBe(true);
    expect(lit(face(MY_ROW, 'Tin Lantern'))).toBe(true);
    expect(bandControls().some((node) => node.textContent === CLEAR_BLOCKS_LABEL)).toBe(true);

    click(face(MY_ROW, 'Palisade Outrider'));
    click(bandControl('Block with 2 creatures'));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('clears every assignment without telling the kernel', () => {
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    const onChoose = draw(state);
    click(face(MY_ROW, 'Quarry Hound'));
    click(bandControl(CLEAR_BLOCKS_LABEL));
    expect(strip()).toEqual(['Ember Courser']);
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('taking a press back', () => {
  it('toggles a creature the kernel gave one answer', () => {
    // One attacker is the commonest combat and the reason the gesture is blocker
    // first: the kernel offers that creature exactly one attacker, so the press
    // is the whole decision and a question with one answer is not a question.
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    draw(state);
    click(face(MY_ROW, 'Quarry Hound'));
    expect(strip()).toHaveLength(2);
    click(face(BAND, 'Quarry Hound'));
    expect(strip()).toEqual(['Ember Courser']);
  });

  it('closes an open question when the creature it is about is pressed again', () => {
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover')],
      [creature('Quarry Hound')],
    );
    draw(state);
    click(face(MY_ROW, 'Quarry Hound'));
    expect(lit(face(BAND, 'Ember Courser'))).toBe(true);
    click(face(MY_ROW, 'Quarry Hound'));
    // The question is shut: no attacker is a control, and nothing was assigned.
    expect(lit(face(BAND, 'Ember Courser'))).toBe(false);
    expect(strip()).toEqual(['Ember Courser', 'Salt Marsh Drover']);
  });

  it('closes it on Escape as well, which is the key every panel on this route answers', () => {
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover')],
      [creature('Quarry Hound')],
    );
    draw(state);
    click(face(MY_ROW, 'Quarry Hound'));
    const table = root().querySelector('.mtg-play');
    if (table === null) throw new Error('no table');
    fireEvent.keyDown(table as unknown as Parameters<typeof fireEvent.keyDown>[0], { key: 'Escape' });
    expect(lit(face(BAND, 'Ember Courser'))).toBe(false);
  });
});

describe('what the gesture must not cost', () => {
  it('leaves the rail the complete enumeration it was', () => {
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover')],
      [creature('Quarry Hound'), creature('Tin Lantern')],
    );
    draw(state);
    const rail = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    // The confirm and one row per creature, which is what `declare.test.ts`
    // asserts and what `rail.ts`'s contract rests on. Pressing a card changes
    // what the rows *say*, never how many there are.
    expect(within(rail).getAllByRole('button')).toHaveLength(3);
    click(face(MY_ROW, 'Quarry Hound'));
    click(face(BAND, 'Ember Courser'));
    const rows = within(
      screen.getByRole('group', { name: declarationWords('declareBlockers').roster }),
    ).getAllByRole('button');
    expect(rows.map((row) => attr(row, 'aria-label'))).toEqual([
      "Quarry Hound, blocks Bot's Ember Courser",
      'Tin Lantern, not blocking',
    ]);
  });

  it('leaves the ring where the press was, which is not the same place twice', () => {
    // A question opened from the rail pulls the ring to its first answer, which
    // is `cast-panel.ts`'s rule: a panel that opens behind the keyboard is a
    // panel the keyboard has to go looking for. A question opened from the table
    // must not, because the ring is already on the card the player pressed and
    // the panel is a column away from where they are looking. One question, one
    // model, two rings, and this is the whole of the difference.
    const state = blockingState(
      [creature('Ember Courser'), creature('Salt Marsh Drover')],
      [creature('Quarry Hound')],
    );
    const words = declarationWords('declareBlockers');

    draw(state);
    click(face(MY_ROW, 'Quarry Hound'));
    expect(answersHoldTheRing(words.ask('Quarry Hound'))).toBe(false);

    cleanup();
    draw(state);
    const row = within(screen.getByRole('group', { name: words.roster })).getByRole('button', {
      name: /^Quarry Hound/,
    });
    fireEvent.click(row);
    expect(answersHoldTheRing(words.ask('Quarry Hound'))).toBe(true);
  });

  it('answers no gesture but the press while a block is being built', () => {
    // The confirm boundary defended at the input end, exactly as the attack
    // declaration defends it: a double click submits a card's default move and a
    // right click lists its options, and at this decision every one of those
    // options is a whole declaration.
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    const onChoose = draw(state);
    const card = face(MY_ROW, 'Quarry Hound');
    fireEvent.doubleClick(card as unknown as Parameters<typeof fireEvent.doubleClick>[0]);
    fireEvent.contextMenu(card as unknown as Parameters<typeof fireEvent.contextMenu>[0]);
    expect(onChoose).not.toHaveBeenCalled();
    expect(all('.mtg-picker')).toHaveLength(0);
  });

  it('leaves the opposing row alone at every decision that is not a block', () => {
    // An opposing permanent is not the viewer's to click. It becomes an answer
    // only while a question about one of their creatures is open, and this is
    // the negative half of that.
    const state = blockingState([creature('Ember Courser')], [creature('Quarry Hound')]);
    draw(state);
    expect(lit(face(BAND, 'Ember Courser'))).toBe(false);
  });
});

describe('the gesture model on its own', () => {
  it('offers nothing at a decision that is not a block', () => {
    expect(blockGesture(null)).toBe(NO_BLOCK_GESTURE);
    const attack = scenario({ seed: 'test/play/block-gesture/attack', active: 0, turn: 3 }).state;
    expect(pendingDecision(attack)).not.toBeNull();
    // An attack is a set over your own row rather than a pairing across the
    // seam, so it stages in `combat.ts` and this returns nothing for it.
    expect(
      blockGesture({
        plan: { kind: 'declareAttackers', player: 0, subjects: [], byAssignment: new Map() },
        stage: { kind: 'roster' },
        assignment: new Map(),
      }),
    ).toBe(NO_BLOCK_GESTURE);
  });
});
