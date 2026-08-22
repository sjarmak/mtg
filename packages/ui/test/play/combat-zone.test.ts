// @vitest-environment jsdom
/**
 * The seam holding the creatures fighting over it, and the confirm they cross.
 *
 * Four asks from the playtester on 2026-08-14 landed as one arrangement, and this
 * file holds the three that are about combat. The board says things by where a
 * card is and how it is drawn rather than by stacking three-letter labels on it:
 * an attacker is *in* the band instead of wearing `ATK`, a proposal is in the
 * band differently from a declaration, and the whole declaration crosses to the
 * kernel once.
 *
 * **Two claims here are about pixels and neither is asserted as one.** jsdom
 * performs no layout — `getBoundingClientRect` is all zeros — so what this file
 * can say about the band's height is which declaration wins the cascade over the
 * emitted sheet, exactly as `tapped-slot.test.ts` says of the rotated slot. What
 * the band actually measures at four viewports, and whether a band full of
 * rotated attackers overhangs its neighbors the way `mtg-bm1` did, is
 * `../../tools/combat-zone.ts` driven in chrome-headless-shell 151.
 *
 * **And one is about a screen reader, which is asserted here and nowhere else.**
 * Position is not readable and neither is an underline, so every fact the
 * drawing took over still has to arrive as words. That is the half of this
 * change that would fail silently.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { Board } from '../../src/board/Board';
import { COMBAT_ZONE_LABEL } from '../../src/board/CombatZone';
import { attackChoice, NO_ATTACKS_LABEL } from '../../src/routes/play/combat';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0 as PlayerId;
const RAIDER = exampleCard('slc-emberflow-raider');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/** Two creatures of yours that may attack, and one of theirs that may block. */
function combat(): GameState {
  return scenario({
    battlefield: [
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: GUARDIAN, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
    ],
    step: 'declareAttackers',
    active: 0,
    turn: 4,
  }).state;
}

function seated(state: GameState): GameSession {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat('You'), botSeat(simpleAgent('Bot'))],
    state,
    events: [],
    result: null,
    pending: decision,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * The node and window members this file reads, checked at runtime rather than
 * imported: the workspace tsconfig carries no `lib: dom`, so `document` is not a
 * known global here and `HTMLElement` holds none of these. `./click.test.ts` and
 * `./hand-scale.test.ts` declare their own shapes for the same reason.
 */
interface NodeLike {
  className: string;
  textContent: string;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<NodeLike> & Iterable<NodeLike>;
  readonly appendChild: (child: NodeLike) => void;
  readonly remove: () => void;
}

interface StyleLike {
  readonly height: string;
  readonly minHeight: string;
  readonly background: string;
}

interface WindowLike {
  readonly document: {
    readonly head: NodeLike;
    readonly body: NodeLike;
    readonly createElement: (tag: string) => NodeLike;
  };
  readonly getComputedStyle: (element: NodeLike) => StyleLike;
}

function windowLike(): WindowLike {
  const candidate = globalThis as Partial<WindowLike>;
  const doc = candidate.document;
  if (doc === undefined || typeof candidate.getComputedStyle !== 'function') {
    throw new Error('this test needs a jsdom window');
  }
  return { document: doc, getComputedStyle: candidate.getComputedStyle };
}

function nodeOf(value: NodeLike | null, what: string): NodeLike {
  if (value === null) throw new Error(`expected ${what} in the document`);
  return value;
}

/** The rendered table. Every query in this file starts here. */
function bodyNode(): NodeLike {
  return windowLike().document.body;
}

function oidOf(state: GameState, name: string, controller: PlayerId): ObjectId {
  const found = state.battlefield.find(
    (oid) => state.objects[oid]?.controller === controller && state.objects[oid]?.card.name === name,
  );
  if (found === undefined) throw new Error(`no ${name} on the battlefield`);
  return found;
}

/** A state with the attack already declared, which is what the kernel records. */
function attacking(blocked: boolean): GameState {
  const state = combat();
  const raider = oidOf(state, RAIDER.name, 0);
  const drake = oidOf(state, DRAKE.name, 1);
  return {
    ...state,
    combat: {
      ...state.combat,
      attacks: [{ oid: raider, defender: 1 as PlayerId }],
      blocks: blocked ? [{ attacker: raider, blockers: [drake] }] : [],
    },
  };
}

function boardMarkup(state: GameState): string {
  return renderToStaticMarkup(h(Board, boardPosition(state, VIEWER, NAMES)));
}

describe('an attacker is drawn in the seam rather than in its row', () => {
  it('leaves the row it came from and enters the band, with its seat named on it', () => {
    const state = attacking(false);
    const raider = oidOf(state, RAIDER.name, 0);
    render(h(Board, boardPosition(state, VIEWER, NAMES)));
    const band = nodeOf(bodyNode().querySelector(`[aria-label='${COMBAT_ZONE_LABEL}']`), 'the band');
    // The card itself, not a copy of it: one node on the whole table carries
    // this permanent's key, and it is inside the band.
    expect(bodyNode().querySelectorAll(`[data-permanent-key='${raider}']`)).toHaveLength(1);
    expect(band.querySelector(`[data-permanent-key='${raider}']`)).not.toBeNull();
    const row = nodeOf(bodyNode().querySelector('.mtg-board__spells'), 'a spells row');
    expect(row.querySelector(`[data-permanent-key='${raider}']`)).toBeNull();
    // And which half of the table it came from, which is the seat's own paper
    // along its near edge rather than a word (`styles/board/band.ts`).
    const entry = nodeOf(band.querySelector(".mtg-combat__entry[data-state='declared']"), 'a declared entry');
    expect(entry.getAttribute('data-seat')).toBe('you');
  });

  it('keeps the seat counting it, because the seat still controls it', () => {
    // The row draws two permanents and the seat controls three. A head that said
    // two would be reporting the drawing rather than the game.
    const markup = boardMarkup(attacking(false));
    expect(markup).toContain('class="mtg-zone__count">2<');
  });

  it('collapses back to a bar when nobody is attacking', () => {
    const markup = boardMarkup(combat());
    expect(markup).toContain('class="mtg-board__divider" data-combat="false"');
    expect(markup).not.toContain('mtg-combat__entry');
  });
});

describe('what a screen reader gets when the drawing took over', () => {
  /**
   * The badge said `ATK` and nothing else — not whom, not whether it was
   * getting through. Position replaced the badge for a sighted player and
   * replaces nothing at all for a reader, so the sentence stayed on the card and
   * grew: `attackingMark` names the defender (CR 508.1a) and the blockers
   * assigned to it (CR 509.1a), which is strictly more than the badge ever said.
   */
  it('says who is being attacked, and that nothing is blocking', () => {
    render(h(Board, boardPosition(attacking(false), VIEWER, NAMES)));
    expect(screen.getByLabelText('Attacking Bot, unblocked.')).toBeTruthy();
    expect(screen.queryByText('ATK')).toBeNull();
  });

  it('names what is blocking it, on the attacker and on the blocker', () => {
    render(h(Board, boardPosition(attacking(true), VIEWER, NAMES)));
    expect(screen.getByLabelText(`Attacking Bot, blocked by Bot's ${DRAKE.name}.`)).toBeTruthy();
    // The blocker did not move — CR 509.1a makes a block an assignment to one
    // attacker, so a blocker in a shared band without its attacker beside it
    // would say less than this does — so it keeps a visible badge, and the badge
    // gained the only question worth asking of it.
    expect(screen.getByText('BLK')).toBeTruthy();
    expect(screen.getByLabelText(`Blocking your ${RAIDER.name}.`)).toBeTruthy();
  });

  it('draws no derived-size badge and still says both numbers', () => {
    // The playtester, 2026-08-14: "the modified power toughness from static effects
    // does not need to be repeated on a label in black and white on a card, the
    // underlining of the power and toughness on the card itself is sufficient".
    const state = combat();
    const raider = oidOf(state, RAIDER.name, 0);
    const object = state.objects[raider];
    if (object === undefined) throw new Error('the scenario dealt no raider');
    const pumped: GameState = {
      ...state,
      objects: {
        ...state.objects,
        [raider]: { ...object, counters: { ...object.counters, plusOnePlusOne: 2 } },
      },
    };
    render(h(Board, boardPosition(pumped, VIEWER, NAMES)));
    const mark = nodeOf(bodyNode().querySelector(".mtg-mark[data-mark='derived']"), 'the derived mark');
    expect(mark.getAttribute('aria-label')).toMatch(/^Now .*printed/);
    expect(mark.textContent).toBe('');
    expect(mark.getAttribute('data-silent')).toBe('true');
    // The underline the badge handed off to is selected through this very mark,
    // so the mark stays in the tree whatever it looks like.
    expect(uiStyleSheet()).toContain(
      ".mtg-slot:has(.mtg-slot__marks .mtg-mark[data-mark='derived']) .mtg-card__pt {",
    );
  });
});

describe('the seam under the cascade', () => {
  /**
   * `styles/board/mat.ts` declares `.mtg-board__divider` one pixel tall and
   * `styles/board/band.ts` declares it again at the same specificity, so the
   * only thing separating them is sheet order — which `styles/board/index.ts`
   * owns and records. A band that lost that tie would clip every card in it, so
   * this asserts the winner rather than trusting the docblock. It proves no
   * pixel; `../../tools/combat-zone.ts` is where the height is measured.
   */
  it('lets the band beat the keyline, and floors an empty seam at the bar', () => {
    const { document: doc, getComputedStyle } = windowLike();
    const style = doc.createElement('style');
    style.textContent = uiStyleSheet();
    doc.head.appendChild(style);
    const bar = doc.createElement('div');
    bar.className = 'mtg-board__divider';
    doc.body.appendChild(bar);
    const resolved = getComputedStyle(bar);
    expect(resolved.height, 'the one-pixel keyline in mat.ts won the tie').toBe('auto');
    expect(resolved.minHeight).not.toBe('0px');
    expect(resolved.background).toContain('var(--mtg-mat-seam)');
    style.remove();
    bar.remove();
  });

  /**
   * Two findings from driving `../../tools/combat-zone.ts` in
   * chrome-headless-shell 151, kept here because both regress in the sheet.
   *
   * The confirm was drawn inside the same scroller as the attackers, and at
   * 1024x768 with three of them it sat past the band's right edge and went out
   * with the scroll: the one control that ends a declaration was the first thing
   * a crowded attack pushed off the table. And the entries were allowed to
   * shrink, which is `mtg-bm1` in a new place — a card in the band is sized off
   * the band's height and keeps the printed aspect, so a shrunken entry gives no
   * width back and the face paints over its neighbor: six attackers overlapped
   * in three pairs at 1024x768 and in seven at 810x1080. Both read zero now.
   */
  it('keeps the confirm out of the scroller and the entries out of each other', () => {
    const state = attacking(false);
    render(h(PlayView, { session: seated(state), viewer: VIEWER, names: NAMES, onChoose: () => undefined }));
    const strip = nodeOf(bodyNode().querySelector('.mtg-combat__strip'), 'the strip');
    expect(strip.querySelector('.mtg-combat__entry')).not.toBeNull();
    expect(strip.querySelector('.mtg-combat__controls'), 'the confirm scrolls with the attackers').toBeNull();
    expect(bodyNode().querySelector('.mtg-combat__controls')).not.toBeNull();

    const sheet = uiStyleSheet();
    const block = (selector: string): string => {
      const found = sheet.split(`\n${selector} {`)[1]?.split('}')[0];
      if (found === undefined) throw new Error(`the sheet declares nothing for ${selector}`);
      return found;
    };
    expect(block('.mtg-combat__strip')).toContain('overflow-x: auto');
    expect(block(".mtg-board__divider[data-combat='true']")).toContain('overflow: hidden');
    expect(block('.mtg-combat__entry'), 'a shrinking entry is mtg-bm1 again').toContain('flex: none');
  });
});

describe('an attack is built by clicking and submitted once', () => {
  it('stages, unstages, and records nothing until the confirm', () => {
    const session = seated(combat());
    const raider = oidOf(session.state, RAIDER.name, 0);
    const guardian = oidOf(session.state, GUARDIAN.name, 0);
    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    // Re-queried every time rather than captured: staging reparents the card
    // into the band, so React builds a new element and a node held from before
    // the click is detached. A captured node answers a second click with nothing.
    const faceFor = (oid: ObjectId): NodeLike =>
      nodeOf(bodyNode().querySelector(`[data-permanent-key='${oid}'] button.mtg-card`), `a face for ${oid}`);
    const staged = (): string[] =>
      [...bodyNode().querySelectorAll(".mtg-combat__entry[data-state='staged'] [data-permanent-key]")].map(
        (node) => node.getAttribute('data-permanent-key') ?? '',
      );

    // The band is open before anything is staged, because a player being asked
    // for attackers has to see where an attacker goes before choosing one.
    expect(screen.getByRole('group', { name: COMBAT_ZONE_LABEL })).toBeTruthy();
    expect(screen.getByText(NO_ATTACKS_LABEL)).toBeTruthy();

    fireEvent.click(faceFor(raider));
    fireEvent.click(faceFor(guardian));
    expect(staged().sort()).toEqual([guardian, raider].sort());
    // Two creatures staged and nothing said to the kernel. A half-built attack
    // is not a decision anybody has taken.
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.click(faceFor(guardian));
    expect(staged()).toEqual([raider]);
    expect(onChoose).not.toHaveBeenCalled();

    const confirm = nodeOf(bodyNode().querySelector(".mtg-combat__button[data-kind='confirm']"), 'a confirm');
    expect(confirm.textContent).toBe('Attack with 1');
    fireEvent.click(confirm);

    // Exactly one choice, and it is the option that declares exactly the staged
    // set — matched on the action's own attacker list rather than on its label.
    expect(onChoose).toHaveBeenCalledTimes(1);
    const index = onChoose.mock.calls[0]?.[0] as number;
    const option = session.pending?.options[index];
    if (option === undefined || option.type !== 'declareAttackers') {
      throw new Error('the confirm submitted something that is not an attack');
    }
    expect(option.attackers.map((attack) => attack.oid)).toEqual([raider]);
  });

  it('offers attacking with everything, and stages only what may attack', () => {
    const session = seated(combat());
    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    const all = screen.getByLabelText('Attack with all 2 creatures that can attack');
    fireEvent.click(all);
    // It stages rather than declaring, which is the confirm boundary holding:
    // Magic Online's own all-attack button selects and still waits for the OK.
    expect(onChoose).not.toHaveBeenCalled();
    expect(bodyNode().querySelectorAll(".mtg-combat__entry[data-state='staged']")).toHaveLength(2);
    // The opponent's blocker is untouched by it. `eligible` is the kernel's own
    // list of creatures that may attack, so nothing outside it can be staged.
    expect(screen.getByText('Attack with 2')).toBeTruthy();
  });

  it('submits the enumeration index for a set the enumeration carries', () => {
    // The board every game is played on: two creatures, four subsets, every one
    // of them on the list. What crosses to the kernel is the integer it always
    // was, which is the half of `mtg-dwd`'s fix that has to stay invisible.
    const session = seated(combat());
    const decision = session.pending;
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack to declare');
    const raider = oidOf(session.state, RAIDER.name, 0);

    expect(attackChoice(session.state, decision, new Set())).toBe(0);
    expect(attackChoice(session.state, decision, new Set([raider]))).toBe(
      decision.options.findIndex(
        (option) =>
          option.type === 'declareAttackers' &&
          option.attackers.length === 1 &&
          option.attackers[0]?.oid === raider,
      ),
    );
    // A key naming nothing on the board is not a set of attackers, so it is
    // refused rather than declared: `validateAction` re-derives eligibility, and
    // the filter that builds the declaration finds nothing to put in it. What
    // comes back is the empty declaration's index, never a neighboring set.
    expect(attackChoice(session.state, decision, new Set(['no-such-object']))).toBe(0);
  });
});
