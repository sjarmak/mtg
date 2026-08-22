// @vitest-environment jsdom
/**
 * What the stack is aimed at, drawn on the board it is aimed at.
 *
 * The playtester, playing (`mtg-njrp`): the bot moves to equip one of her two
 * identical creatures, she wants to kill the one being targeted, and there is no
 * way to tell which is which. `../../src/routes/play/naming.ts` argued that case
 * away — "two twins that differ in nothing read alike, and that is the true
 * statement about them" — and the argument was sound about the *board* and false
 * about the *stack*. `the fact the whole fix rests on` below is the proof: kill
 * the targeted one and the equip fizzles, kill the other and it does not, so the
 * choice between two creatures that differ in nothing is not free at all.
 *
 * The relationship is between a stack object and a board object, so it is drawn
 * rather than named: one reticle on the permanent, the matching reticle on the
 * entry doing the aiming, and the entry's place in the resolution order as the
 * number that pairs them.
 *
 * ## Two claims here are about paint and are not made here
 *
 * jsdom lays nothing out, so "the ring is drawn inside the card's box" and "the
 * badge is legible at four permanents a side" are claims no assertion in this
 * file can hold. They were measured in chrome-headless-shell 151.0.7922.47 over
 * CDP on the flagship set at 1280x800, and the numbers are in the bead. What is
 * asserted here instead is the *sheet text* — that the rule is an inset dashed
 * outline on the slot rather than an outer ring on the card — because the
 * clipping the offset avoids is a property of the declaration and not of the
 * frame it renders in.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { AbilityInput, Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, Decision, GameSession, GameState, ObjectId } from '@mtg/kernel';
import {
  attachmentOf,
  humanSeat,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  stateFingerprint,
} from '@mtg/kernel';
import { permanentMarks } from '../../src/board/Battlefield';
import { PlayView } from '../../src/routes/play/PlayView';
import { distinguishingLine, permanentName } from '../../src/routes/play/naming';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
/** Both seats named, which is the hot-seat table and has no "your" seat. */
const HOTSEAT: SeatNames = ['Player one', 'Player two'];

const TWIN: Card = parseCard({
  kind: 'creature',
  id: 'lab-harbor-sentinel',
  name: 'Harbor Sentinel',
  rarity: 'common',
  set: { code: 'LAB', collectorNumber: 3 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  power: 2,
  toughness: 2,
});

const BLADE: Card = parseCard({
  kind: 'artifact',
  id: 'lab-bronze-cudgel',
  name: 'Bronze Cudgel',
  rarity: 'rare',
  set: { code: 'LAB', collectorNumber: 4 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
  ],
});

const SMITE: Card = parseCard({
  kind: 'instant',
  id: 'lab-swift-verdict',
  name: 'Swift Verdict',
  rarity: 'common',
  set: { code: 'LAB', collectorNumber: 5 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
});

const DEATH_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDies',
  effects: [{ kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } }],
};

const HERALD: Card = parseCard({
  kind: 'creature',
  id: 'lab-marsh-herald',
  name: 'Marsh Herald',
  rarity: 'common',
  set: { code: 'LAB', collectorNumber: 6 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  power: 1,
  toughness: 1,
  abilities: [DEATH_TRIGGER],
});

const PLAINS = basicLand('Plains', 'LAB', 250);

function step(state: GameState, action: Action): GameState {
  return reduce(state, action).state;
}

/** The pass the seat being asked is holding, whoever that seat is. */
function passOf(state: GameState): Action {
  const pass = pendingDecision(state, 512)?.options.find((option) => option.type === 'passPriority');
  if (pass === undefined) throw new Error('no pass was enumerated');
  return pass;
}

function twins(state: GameState): readonly ObjectId[] {
  return state.battlefield.filter((oid) => state.objects[oid]?.card.name === TWIN.name);
}

function oidOf(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

/**
 * The playtester's board: two identical creatures and a weapon under the seat that is
 * about to equip, and the removal in the other seat's hand.
 */
function board(): GameState {
  return scenario({
    seed: 'ui/target-mark',
    battlefield: [
      { card: BLADE, controller: 0 },
      { card: TWIN, controller: 0 },
      { card: TWIN, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 1 },
      { card: PLAINS, controller: 1 },
    ],
    hands: [[], [SMITE]],
  }).state;
}

/** That board with the equip paid for and waiting on the stack. */
function equipStaged(): GameState {
  const start = board();
  const equip = pendingDecision(start, 512)?.options.find((option) => option.type === 'activateAbility');
  if (equip === undefined) throw new Error('no equip was enumerated');
  return step(start, equip);
}

/** The removal in the other seat's hand, aimed at one named creature. */
function smiteAt(state: GameState, victim: ObjectId): GameState {
  const held = step(state, passOf(state));
  const cast = pendingDecision(held, 512)?.options.find(
    (option) =>
      option.type === 'castSpell' &&
      held.objects[option.oid]?.card.name === SMITE.name &&
      option.targets.some(
        (target) => target !== null && target.kind === 'permanent' && target.oid === victim,
      ),
  );
  if (cast === undefined) throw new Error('no removal was enumerated at that creature');
  return step(held, cast);
}

/** Pass with whoever is asked until the stack has run out. */
function settle(state: GameState): GameState {
  let now = state;
  for (let guard = 0; guard < 24 && now.stack.length > 0; guard += 1) {
    now = step(now, passOf(now));
  }
  return now;
}

function sessionAt(state: GameState, names: SeatNames): GameSession {
  return {
    seats: [humanSeat(names[0]), humanSeat(names[1])],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state, 512),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/** Every accessible name on the page that is one of the target mark's. */
function reticleNames(): readonly string[] {
  return screen
    .queryAllByRole('img')
    .map((node) => node as unknown as { getAttribute(name: string): string | null })
    .map((node) => node.getAttribute('aria-label') ?? '')
    .filter((name) => name.startsWith('Targeted by') || name.startsWith('Aimed at'));
}

describe('the fact the whole fix rests on', () => {
  it('fizzles the equip when the targeted twin is killed, and not when the other is', () => {
    const staged = equipStaged();
    const pair = twins(staged);
    const aimed = staged.stack[0]?.targets.find((target) => target !== null && target.kind === 'permanent');
    if (aimed === undefined || aimed === null || aimed.kind !== 'permanent') {
      throw new Error('the equip landed on the stack with no permanent target');
    }
    const other = pair.find((oid) => oid !== aimed.oid);
    if (other === undefined) throw new Error('the board did not hold a twin');

    // CR 608.2b through `resolveAttach`: the weapon has nothing to attach to and
    // the ability leaves the stack having done nothing.
    const killedTarget = settle(smiteAt(staged, aimed.oid));
    expect(attachmentOf(killedTarget, oidOf(killedTarget, BLADE.name))).toBeUndefined();

    // The same removal, the same mana, the other creature: the equip resolves.
    const killedOther = settle(smiteAt(staged, other));
    expect(attachmentOf(killedOther, oidOf(killedOther, BLADE.name))).toBe(aimed.oid);
  });

  it('is a choice no property of either creature could have settled', () => {
    // The premise `naming.ts` was written on, checked rather than assumed: the
    // two bodies are identical, so everything the old line inspected — the size,
    // the tap state, the damage, what is held — returns the same string for both.
    // What separates them is the clause the stack put there, and it is on one of
    // them only.
    const staged = equipStaged();
    const [first, second] = twins(staged);
    if (first === undefined || second === undefined) throw new Error('no twin pair');
    const lines = [distinguishingLine(staged, first), distinguishingLine(staged, second)];
    expect(lines[0]).not.toBe(lines[1]);
    const aimed = lines.filter((line) => line !== null && line.includes('targeted by'));
    expect(aimed).toHaveLength(1);
    const bodies = lines.map((line) => (line ?? '').replace(/^targeted by [\d, ]+ · /, ''));
    expect(bodies[0]).toBe(bodies[1]);
  });
});

describe('the mark on the board', () => {
  it('lands on the targeted twin and on nothing else', () => {
    const staged = equipStaged();
    const position = boardPosition(staged, 1, NAMES);
    const marked = position.opponent.battlefield.permanents.filter(
      (permanent) => (permanent.targetedBy ?? []).length > 0,
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.card.name).toBe(TWIN.name);
    // `You` earns `your`, which is `seat.ts`'s rule and not this file's guess.
    expect(marked[0]?.targetedBy).toEqual([{ order: 1, source: `an ability of your ${BLADE.name}` }]);
    // The permanent it is aimed at, and not merely a permanent of that name.
    const aimed = staged.stack[0]?.targets.find((target) => target !== null && target.kind === 'permanent');
    expect(marked[0]?.key).toBe(
      aimed !== undefined && aimed !== null && aimed.kind === 'permanent' ? aimed.oid : null,
    );
  });

  it('is a picture with a number and a sentence, so it is not read by color', () => {
    const marks = permanentMarks({
      key: 'o1',
      card: TWIN,
      targetedBy: [{ order: 2, source: "Bot's Bronze Cudgel" }],
    });
    expect(marks.map((mark) => mark.key)).toEqual(['targeted-2']);
    expect(marks[0]?.glyph).toBe('reticle');
    expect(marks[0]?.badge).toBe('2');
    expect(marks[0]?.title).toBe("Targeted by Bot's Bronze Cudgel, 2 on the stack.");
    // Nothing about the mark is a tone alone: the shape says targeted, the
    // number says which, the sentence says both. `tone` is decoration over the
    // three of them.
    expect(marks[0]?.silent).toBeUndefined();
  });

  it('draws one reticle per aiming object, top of the stack first', () => {
    const marks = permanentMarks({
      key: 'o1',
      card: TWIN,
      targetedBy: [
        { order: 1, source: "Bot's Swift Verdict" },
        { order: 2, source: "Bot's Bronze Cudgel" },
      ],
    });
    expect(marks.map((mark) => mark.badge)).toEqual(['1', '2']);
  });

  it('is on the table for a keyboard and a screen reader, with nothing to hover', () => {
    render(
      h(PlayView, {
        session: sessionAt(equipStaged(), NAMES),
        viewer: 1,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    // One on the permanent and one on the entry aiming at it: the whole mark is
    // in the accessibility tree at rest, so nothing about it needs a pointer.
    const named = reticleNames();
    expect(named).toHaveLength(2);
    expect(named.filter((name) => name.startsWith('Targeted by'))).toHaveLength(1);
    expect(named.filter((name) => name.startsWith('Aimed at'))).toHaveLength(1);
    // And the sheet gates it on nothing: no rule in the shipped stylesheet makes
    // a target mark conditional on :hover or :focus.
    const rules = uiStyleSheet()
      .split('\n')
      .filter((line) => line.includes("data-mark^='targeted'"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toContain(':hover');
      expect(rule).not.toContain(':focus');
    }
  });

  it('is a ring drawn inside the slot, where the zone cannot clip it', () => {
    // A claim about a declaration rather than about a frame. Three things about
    // it are asserted because each one is a scar: it is inset rather than
    // outside the border box, which is what `styles/board/zone.ts` records
    // losing to `overflow: auto`; it is dashed, so the ring is a shape and not
    // only a color; and it takes no clicks, because the face under it is the
    // button that plays the card.
    const sheet = uiStyleSheet();
    const opener = sheet
      .split('\n')
      .find((line) => line.startsWith('.mtg-slot:has(') && line.includes('targeted'));
    expect(opener).toBeDefined();
    const at = sheet.indexOf(opener ?? '');
    const body = sheet.slice(at, sheet.indexOf('}', at));
    expect(opener).toContain('::after');
    expect(body).toContain('position: absolute');
    expect(body).toContain('inset: 2px');
    expect(body).toContain('dashed');
    expect(body).toContain('pointer-events: none');
  });
});

describe('both seats', () => {
  it('marks a permanent in either row, and says no "your" at a hot-seat table', () => {
    const staged = equipStaged();
    // Seat 0 is the one equipping, so from seat 1's chair the marked creature is
    // in the far row and from seat 0's it is in the near one. Same mark.
    for (const viewer of [0, 1] as const) {
      const position = boardPosition(staged, viewer, HOTSEAT);
      const rows = [position.you, position.opponent];
      const marked = rows.flatMap((side) =>
        side.battlefield.permanents.filter((permanent) => (permanent.targetedBy ?? []).length > 0),
      );
      expect(marked).toHaveLength(1);
      expect(marked[0]?.targetedBy?.[0]?.source).toBe(`an ability of ${HOTSEAT[0]}'s ${BLADE.name}`);
    }
  });

  it('says whose the aiming object is with the possessive the seat label earns', () => {
    const near = boardPosition(equipStaged(), 0, NAMES);
    const marked = near.you.battlefield.permanents.find(
      (permanent) => (permanent.targetedBy ?? []).length > 0,
    );
    // `You` takes `your`, a name takes `'s`, and `seat.ts` is the one copy of
    // that rule. A sentence built by interpolating the raw label would read
    // `You's Bronze Cudgel` here.
    expect(marked?.targetedBy?.[0]?.source).toBe(`an ability of your ${BLADE.name}`);
  });
});

describe('a triggered ability, which is an object with no card', () => {
  /** A creature dies, its death trigger is aimed at one of the twins. */
  function triggerAimed(): GameState {
    const start = scenario({
      seed: 'ui/target-mark-trigger',
      battlefield: [
        { card: HERALD, controller: 0 },
        { card: TWIN, controller: 0 },
        { card: TWIN, controller: 0 },
        { card: PLAINS, controller: 1 },
        { card: PLAINS, controller: 1 },
      ],
      hands: [[], [SMITE]],
    }).state;
    const killed = smiteAt(start, oidOf(start, HERALD.name));
    let now = killed;
    for (let guard = 0; guard < 20; guard += 1) {
      const decision: Decision | null = pendingDecision(now, 512);
      if (decision === null) throw new Error('the game ended before the trigger was aimed');
      if (decision.kind === 'triggerTargets') {
        const aim = decision.options[0];
        if (aim === undefined) throw new Error('the aiming stop offered nothing');
        return step(now, aim);
      }
      now = step(now, passOf(now));
    }
    throw new Error('no trigger stop in 20 decisions');
  }

  it('marks the permanent it is aimed at, named as an ability of its source', () => {
    // CR 113.7a: the ability has no card, so what can be named is the permanent
    // that printed it — which by now is in a graveyard, and is named anyway,
    // because CR 608.2 resolves the ability regardless.
    const aimed = triggerAimed();
    const position = boardPosition(aimed, 1, NAMES);
    const marked = position.opponent.battlefield.permanents.filter(
      (permanent) => (permanent.targetedBy ?? []).length > 0,
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.targetedBy?.[0]?.source).toBe(`an ability of your ${HERALD.name}`);
  });

  it('draws the same reticle on the entry, which has no card of its own', () => {
    render(
      h(PlayView, {
        session: sessionAt(triggerAimed(), NAMES),
        viewer: 1,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const entries = within(screen.getByLabelText('Stack')).getAllByRole('listitem');
    expect(entries).toHaveLength(1);
    expect(textOf(entries[0])).toContain('ability');
    expect(within(entries[0] as never).getByRole('img', { name: /^Aimed at/ })).toBeTruthy();
  });
});

describe('several objects on the stack at once', () => {
  /** The equip aimed at one twin, and removal aimed at the other above it. */
  function bothAimed(): GameState {
    const staged = equipStaged();
    const pair = twins(staged);
    const aimed = staged.stack[0]?.targets.find((target) => target !== null && target.kind === 'permanent');
    const other = pair.find(
      (oid) => !(aimed !== undefined && aimed !== null && aimed.kind === 'permanent' && aimed.oid === oid),
    );
    if (other === undefined) throw new Error('no second twin');
    return smiteAt(staged, other);
  }

  it('gives each twin the number of the object aimed at it, and they differ', () => {
    const state = bothAimed();
    const position = boardPosition(state, 1, NAMES);
    const marked = position.opponent.battlefield.permanents
      .filter((permanent) => (permanent.targetedBy ?? []).length > 0)
      .map((permanent) => permanent.targetedBy?.[0]?.order);
    // Two twins, two objects, two numbers: 1 is the removal on top and 2 is the
    // equip under it, which is the order they will resolve in.
    expect(marked.sort()).toEqual([1, 2]);
  });

  it('numbers the stack rows to match, so the two ends of each mark agree', () => {
    render(
      h(PlayView, {
        session: sessionAt(bothAimed(), NAMES),
        viewer: 1,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const entries = within(screen.getByLabelText('Stack')).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(textOf(entries[0])).toContain('1.');
    expect(
      within(entries[0] as never).getByRole('img', { name: /marked 1 on the battlefield/ }),
    ).toBeTruthy();
    expect(
      within(entries[1] as never).getByRole('img', { name: /marked 2 on the battlefield/ }),
    ).toBeTruthy();
    // And one reticle for each end of each of the two marks.
    expect(reticleNames()).toHaveLength(4);
  });
});

describe('a target that has left the battlefield', () => {
  it('drops both ends of the mark and leaves the entry saying what it was aimed at', () => {
    // The removal resolves and the equip is still on the stack aimed at a
    // creature in a graveyard. There is no permanent to mark, so nothing is
    // marked: a reticle on the entry pairing with nothing on the table would be
    // pointing at a card the player cannot find.
    const staged = equipStaged();
    const aimed = staged.stack[0]?.targets.find((target) => target !== null && target.kind === 'permanent');
    if (aimed === undefined || aimed === null || aimed.kind !== 'permanent') {
      throw new Error('no permanent target');
    }
    let state = smiteAt(staged, aimed.oid);
    state = step(state, passOf(state));
    state = step(state, passOf(state));
    expect(state.stack).toHaveLength(1);
    expect(state.battlefield).not.toContain(aimed.oid);

    const position = boardPosition(state, 1, NAMES);
    const rows = [position.you, position.opponent];
    expect(
      rows.flatMap((side) => side.battlefield.permanents.filter((one) => one.targetedBy !== undefined)),
    ).toHaveLength(0);
    expect(position.stack.entries[0]?.onBoard).toBeUndefined();
    expect(position.stack.entries[0]?.targetLabel).toContain(TWIN.name);

    render(
      h(PlayView, {
        session: sessionAt(state, NAMES),
        viewer: 1,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    expect(reticleNames()).toHaveLength(0);
  });
});

describe('acting on the right one', () => {
  it('separates the two removal buttons the rail offers', () => {
    // The other half of what she hit. Seeing which creature is aimed at is worth
    // nothing if the move that kills it reads exactly like the move that kills
    // its twin, which is `mtg-cee` reaching this board through a property
    // `naming.ts` did not inspect until now.
    const held = step(equipStaged(), passOf(equipStaged()));
    const decision = pendingDecision(held, 512);
    if (decision === null) throw new Error('nothing to decide');
    const casts = buildPrompt(held, decision, NAMES)
      .choices.filter((choice) => choice.kind === 'castSpell')
      .map((choice) => choice.label);
    expect(casts).toHaveLength(2);
    expect(new Set(casts).size).toBe(2);
    expect(casts.filter((label) => label.includes('targeted by 1'))).toHaveLength(1);
  });

  it('leaves the acting to the rail, because the far seat has no clickable face yet', () => {
    // Measured rather than assumed, and it is why the rail's wording above is
    // part of this fix rather than a nicety. The creature being equipped is the
    // *other* seat's, and `../../src/routes/play/table.ts` wires only the
    // viewer's own permanents for clicking (plus attackers during a block), so
    // there is no face to point at: every path to "kill that one" runs through
    // the move list. `mtg-bz2.6` is the lane that adds the other door, and the
    // day it does, this assertion is the one to invert.
    const staged = equipStaged();
    const held = step(staged, passOf(staged));
    const marked = boardPosition(held, 1, NAMES).opponent.battlefield.permanents.find(
      (permanent) => (permanent.targetedBy ?? []).length > 0,
    );
    if (marked === undefined) throw new Error('nothing on the board is marked');
    const { container } = render(
      h(PlayView, {
        session: sessionAt(held, NAMES),
        viewer: 1,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    // `document` is not typed here: this package compiles without `lib: dom`, so
    // the render's own root is cast to the one method being asked for.
    const faces = [
      ...(
        container as unknown as {
          querySelectorAll(selector: string): Iterable<unknown>;
        }
      ).querySelectorAll(`[data-permanent-key='${marked.key}'] button`),
    ];
    expect(faces).toHaveLength(0);
    // The mark is still there to be read, and it is on the far seat's card.
    expect(reticleNames().filter((name) => name.startsWith('Targeted by'))).toHaveLength(1);
  });

  it('names the aimed-at twin the same way wherever the name is printed', () => {
    const staged = equipStaged();
    const aimed = staged.stack[0]?.targets.find((target) => target !== null && target.kind === 'permanent');
    if (aimed === undefined || aimed === null || aimed.kind !== 'permanent') {
      throw new Error('no permanent target');
    }
    // One vocabulary: the number in the button's own name is the number on the
    // badge and the number on the stack row.
    expect(permanentName(staged, aimed.oid)).toContain('targeted by 1');
    expect(boardPosition(staged, 1, NAMES).stack.entries[0]?.onBoard).toBe(true);
  });
});

describe('the mark is a drawing and not a decision', () => {
  it('reaches neither the recorded choices nor the fingerprint', () => {
    // Seed plus choice list is the whole record. Building the position is a read,
    // so a mark can be added, changed or deleted without moving a replay.
    const staged = equipStaged();
    const before = stateFingerprint(staged);
    const first = boardPosition(staged, 0, NAMES);
    const second = boardPosition(staged, 0, NAMES);
    expect(stateFingerprint(staged)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // And the kernel's own state holds no such field to record: what is aimed at
    // what is read off the stack every time it is drawn.
    expect(reduceAll(staged, []).state.stack[0]).toEqual(staged.stack[0]);
  });
});
