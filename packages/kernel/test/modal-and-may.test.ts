/**
 * CR 700.2 modal spells and CR 601.2c "you may" spells, driven through the
 * reducer.
 *
 * `targeted-triggers.test.ts` makes the parallel argument for CR 603.3d/603.3b
 * on abilities; this file is the spell-level widening `mtg-bc2.152.4` adds. A
 * mode is chosen once, at cast (`legal.ts`'s `validateCast`, `stack.ts`'s
 * `pushSpell`), and locked into `StackEntry.mode` for the life of the entry —
 * `@mtg/dsl`'s `effectsFor(card, entry.mode)` reads it back at every
 * resolution site rather than re-deciding. A "you may" is asked once, as the
 * spell resolves, of whichever player `card.may` names — `you`, the
 * controller, or `opponent`, a chooser CR 603.3b's ability-level mechanism
 * never needed, because a triggered ability's controller is never in doubt
 * the way a spell's named chooser can be someone else's decision entirely.
 *
 * The last describe block plays a seeded game containing both mechanisms and
 * replays it from its choice list, the same non-negotiable this codebase asks
 * of every new decision variant: a game is a seed plus a list of small
 * integers, so a `mode`-bearing or `may`-answering choice that is not
 * recorded, or that replays in a different order, silently corrupts every
 * recording.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect, ManaCostInput, MayChooser, Mode } from '@mtg/dsl';
import { colorsFromCost, mana, parseCard } from '@mtg/dsl';
import type { Action, GameSession, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  botSeat,
  choose,
  copySpellOnStack,
  createSession,
  eventsOfType,
  humanSeat,
  pendingDecision,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';
import { apply, oidOf } from './helpers';

let fixtureCounter = 0;

function nextFixtureId(prefix: string): string {
  fixtureCounter += 1;
  return `tst-${prefix}-${String(fixtureCounter)}`;
}

/** A modal sorcery, `dsl/test/modal.test.ts`'s fixture with a Card behind it. */
function modalSorcery(name: string, modes: readonly Mode[], cost: ManaCostInput = { generic: 1 }): Card {
  const manaCost = mana(cost);
  return parseCard({
    kind: 'sorcery',
    id: nextFixtureId('modal'),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: (fixtureCounter % 900) + 1 },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects: [],
    modes,
  });
}

/** An instant that asks its printed chooser CR 601.2c's yes/no before resolving. */
function mayInstant(
  name: string,
  effects: readonly Effect[],
  may: MayChooser,
  cost: ManaCostInput = { generic: 1 },
): Card {
  const manaCost = mana(cost);
  return parseCard({
    kind: 'instant',
    id: nextFixtureId('may'),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: (fixtureCounter % 900) + 1 },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects,
    may,
  });
}

const BOLT_MODE: Mode = { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }] };
const DRAW_MODE: Mode = { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] };

/**
 * `targeted-triggers.test.ts`'s driver, unchanged: passes priority until the
 * stack has emptied or the kernel asks something that is not a priority.
 * `castSpell` only pushes an entry — it never resolves it — so every test
 * below that wants to see a spell's effect, or its "you may" pause, has to
 * pass priority around the table first.
 */
function passUntilQuiet(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('passUntilQuiet: the stack never emptied and nothing else was asked');
}

describe('a modal spell chooses its mode at cast (CR 700.2)', () => {
  function board() {
    const spell = modalSorcery('Reckoning of Embers', [BOLT_MODE, DRAW_MODE]);
    // Toughness 5 survives BOLT_MODE's 3 damage: the damage-mode test reads
    // the marked damage off a live object, and a lethal 3-into-2 would move
    // the creature to the graveyard, where damage resets to 0 on zone change
    // (it does not carry over), making that assertion fail for the wrong
    // reason.
    const target = creature('Merfolk Recruit', 2, 5);
    const start = scenario({
      battlefield: [
        { card: target, controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[spell], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no modal spell in hand');
    return { start, spell, inHand };
  }

  it('offers one castSpell action per mode', () => {
    const { start } = board();
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody has priority');
    const casts = decision.options.filter(
      (action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell',
    );
    expect(casts.map((action) => action.mode).sort()).toEqual([0, 1]);
  });

  it('resolves mode 0 as the damage mode and leaves mode 1 unrun', () => {
    const { start, inHand } = board();
    const target = oidOf(start.state, 'Merfolk Recruit');
    const resolved = passUntilQuiet(
      apply(start, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: target }],
        mode: 0,
      }),
    );
    expect(resolved.state.objects[target]?.damage).toBe(3);
    expect(resolved.state.players[0].hand.length).toBe(0);
    // Drawing did not happen: the library is exactly what it started as.
    expect(resolved.state.players[0].library.length).toBe(start.state.players[0].library.length);
  });

  it('resolves mode 1 as the draw mode and deals no damage', () => {
    const { start, inHand } = board();
    const target = oidOf(start.state, 'Merfolk Recruit');
    const before = start.state.players[0].hand.length;
    const resolved = passUntilQuiet(
      apply(start, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        // Mode 1 needs no target: `noTarget` still owes one target slot, filled
        // with `null`, the same convention every no-target effect uses.
        targets: [null],
        mode: 1,
      }),
    );
    expect(resolved.state.objects[target]?.damage).toBe(0);
    // The card itself left the hand and the draw mode replaced it with one
    // card, so the hand is back to the size it started at.
    expect(resolved.state.players[0].hand.length).toBe(before);
  });

  it('refuses casting a modal spell with no mode chosen', () => {
    const { start, inHand } = board();
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Merfolk Recruit') }],
      }),
    ).toBe('this spell is modal and needs a chosen mode');
  });

  it('refuses a mode index outside the card range', () => {
    const { start, inHand } = board();
    const target = oidOf(start.state, 'Merfolk Recruit');
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: target }],
        mode: 2,
      }),
    ).toBe('mode is out of range');
  });

  it('refuses a mode argument on a card with no modes to choose', () => {
    const plain = instant(
      'Plain Verdict',
      [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      {
        generic: 1,
      },
    );
    const target = creature('Merfolk Recruit', 2, 2);
    const start = scenario({
      battlefield: [
        { card: target, controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[plain], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no spell in hand');
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Merfolk Recruit') }],
        mode: 0,
      }),
    ).toBe('this spell has no modes to choose');
  });
});

describe('a "you may" spell is answered as it resolves (CR 601.2c)', () => {
  function board(may: MayChooser) {
    const spell = mayInstant(
      'Mercy of Aelune',
      [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      may,
    );
    const target = creature('Merfolk Recruit', 2, 2);
    const start = scenario({
      battlefield: [
        { card: target, controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[spell], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no may spell in hand');
    const targetOid = oidOf(start.state, 'Merfolk Recruit');
    const cast = passUntilQuiet(
      apply(start, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: targetOid }],
      }),
    );
    return { cast, targetOid, spellOid: inHand };
  }

  it('pauses after the target recheck, before resolutionBegan', () => {
    const { cast, spellOid } = board('you');
    const decision = pendingDecision(cast.state);
    if (decision?.kind !== 'may') throw new Error('no "you may" spell is resolving');
    expect(decision.player).toBe(0);
    expect(decision.oid).toBe(spellOid);
    expect(decision.options).toEqual([
      { type: 'answerMay', player: 0, oid: spellOid, accept: true },
      { type: 'answerMay', player: 0, oid: spellOid, accept: false },
    ]);
    expect(eventsOfType(cast.events, 'resolutionBegan').some((e) => e.oid === spellOid)).toBe(false);
  });

  it('resolves the effect and reports exactly one resolution when accepted', () => {
    const { cast, targetOid, spellOid } = board('you');
    const taken = apply(cast, { type: 'answerMay', player: 0, oid: spellOid, accept: true });
    expect(taken.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(eventsOfType(taken.events, 'resolutionBegan').filter((e) => e.oid === spellOid).length).toBe(1);
    expect(eventsOfType(taken.events, 'spellDeclined').length).toBe(0);
  });

  it('sends the spell to the graveyard unresolved when declined', () => {
    const { cast, targetOid, spellOid } = board('you');
    const declined = apply(cast, { type: 'answerMay', player: 0, oid: spellOid, accept: false });
    expect(declined.state.objects[targetOid]?.zone).toBe('battlefield');
    expect(declined.state.objects[spellOid]?.zone).toBe('graveyard');
    const said = eventsOfType(declined.events, 'spellDeclined');
    expect(said.length).toBe(1);
    expect(said[0]?.oid).toBe(spellOid);
    expect(said[0]?.player).toBe(0);
    expect(eventsOfType(declined.events, 'resolutionBegan').some((e) => e.oid === spellOid)).toBe(false);
  });

  it('refuses every action but the two printed answers while the question stands', () => {
    const { cast, spellOid } = board('you');
    expect(validateAction(cast.state, { type: 'passPriority', player: 0 })).toBe(
      'you owe a different decision first',
    );
    expect(validateAction(cast.state, { type: 'answerMay', player: 1, oid: spellOid, accept: true })).toBe(
      "it is player 0's decision",
    );
    expect(
      validateAction(cast.state, { type: 'answerMay', player: 0, oid: spellOid, accept: true }),
    ).toBeNull();
  });

  it('asks the opponent when the card names the opponent as chooser', () => {
    const { cast, spellOid } = board('opponent');
    const decision = pendingDecision(cast.state);
    if (decision?.kind !== 'may') throw new Error('no "you may" spell is resolving');
    expect(decision.player).toBe(1);
    expect(validateAction(cast.state, { type: 'answerMay', player: 0, oid: spellOid, accept: true })).toBe(
      "it is player 1's decision",
    );
    expect(
      validateAction(cast.state, { type: 'answerMay', player: 1, oid: spellOid, accept: true }),
    ).toBeNull();
  });
});

describe('a copy of a "you may" spell is asked on its own terms (CR 707.10)', () => {
  /**
   * A copied spell is a stack entry with no object in the object table — its
   * card lives on `entry.copiedSpell` — so every place that reaches a
   * resolving spell's card or its departure zone has to go through there
   * first. `resolveTop` always did; the "you may" question and its answer did
   * not, which made a copy of one of these cards a crash rather than a
   * decision. `unless-toll.test.ts` guards the same seam for CR 118.8's toll,
   * where it was found.
   */
  it('asks the copy, and the copy leaves no card behind either way', () => {
    const spell = mayInstant(
      'Mercy of Aelune',
      [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      'you',
    );
    const target = creature('Merfolk Recruit', 2, 2);
    const start = scenario({
      battlefield: [
        { card: target, controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[spell], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no may spell in hand');
    const targetOid = oidOf(start.state, 'Merfolk Recruit');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: inHand,
      targets: [{ kind: 'permanent', oid: targetOid }],
    });

    const copied = copySpellOnStack(beginTrace(cast.state), inHand);
    const copyOid = copied.state.stack.at(-1)?.oid;
    if (copyOid === undefined || copyOid === inHand) throw new Error('the spell was not copied');
    const withCopy = passUntilQuiet({ state: copied.state, events: [...cast.events, ...copied.events] });

    const decision = pendingDecision(withCopy.state);
    if (decision?.kind !== 'may') throw new Error('the copy asked nothing');
    expect(decision.oid).toBe(copyOid);

    const declined = passUntilQuiet(
      apply(withCopy, { type: 'answerMay', player: 0, oid: copyOid, accept: false }),
    );
    expect(declined.state.objects[copyOid]).toBeUndefined();
    expect(eventsOfType(declined.events, 'spellDeclined').some((e) => e.oid === copyOid)).toBe(true);
    // The original is still there to be asked, and it is a real card in a zone.
    expect(declined.state.objects[targetOid]?.zone).toBe('battlefield');
    expect(pendingDecision(declined.state)).toMatchObject({ kind: 'may', oid: inHand });

    const accepted = apply(withCopy, { type: 'answerMay', player: 0, oid: copyOid, accept: true });
    expect(accepted.state.objects[copyOid]).toBeUndefined();
    expect(accepted.state.objects[targetOid]?.zone).toBe('graveyard');
  });
});

describe('a fizzled "you may" spell is never asked (CR 608.2b before CR 601.2c)', () => {
  it('bounces the only target in response, and the question never arrives', () => {
    const spell = mayInstant(
      'Mercy of Aelune',
      [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      'you',
      {
        generic: 1,
      },
    );
    const rescue = instant('Rescue', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const bounce = creature('Merfolk Recruit', 2, 2);
    const start = scenario({
      battlefield: [
        { card: bounce, controller: 1 },
        ...lands(FOREST, 3).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[spell, rescue], []],
    });
    const [mayOid, rescueOid] = start.state.players[0].hand;
    if (mayOid === undefined || rescueOid === undefined) throw new Error('hand is short');
    const target = oidOf(start.state, 'Merfolk Recruit');

    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: mayOid,
      targets: [{ kind: 'permanent', oid: target }],
    });
    const responded = apply(cast, {
      type: 'castSpell',
      player: 0,
      oid: rescueOid,
      targets: [{ kind: 'permanent', oid: target }],
    });

    const settled = passUntilQuiet(responded);

    // The stack emptied on its own rather than stopping at a 'may' decision,
    // which is the whole claim: nobody was ever asked.
    expect(pendingDecision(settled.state)?.kind).toBe('priority');
    expect(eventsOfType(settled.events, 'spellFizzled').some((e) => e.oid === mayOid)).toBe(true);
    expect(eventsOfType(settled.events, 'spellDeclined').length).toBe(0);
    // `resolveTop` still marks the attempt (the same way an ordinary, non-may
    // spell's fizzle does, `finishSpellResolution`'s shared path) — it is the
    // "you may" pause specifically that is skipped, not this event.
    expect(eventsOfType(settled.events, 'resolutionBegan').some((e) => e.oid === mayOid)).toBe(true);
  });
});

describe('a recorded game containing a mode and a may decision replays byte for byte', () => {
  /**
   * `targeted-triggers.test.ts`'s replay describe block, aimed at the two
   * variants this file adds: a `mode`-bearing `castSpell` choice and a `may`
   * decision. The human seat takes the *last* enumerated option at every
   * decision but the opening hand (kept at index 0, for `mulligan.ts`'s
   * ordering — see that file's identical comment), which is what makes a
   * `may` decision resolve to its decline every time it is asked: `[accept,
   * decline]` is `mayDecision`'s fixed order, so "last" is always "no."
   */
  const RECRUIT = creature('Merfolk Recruit', 2, 2, { cost: { generic: 1 } });
  const MODAL = modalSorcery('Reckoning of Embers', [BOLT_MODE, DRAW_MODE], { generic: 1 });
  const MAY = mayInstant(
    'Mercy of Aelune',
    [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
    'you',
    {
      generic: 1,
    },
  );

  const deck = (name: string) => ({
    name,
    cards: [
      ...lands(FOREST, 12),
      ...Array.from({ length: 6 }, () => RECRUIT),
      ...Array.from({ length: 6 }, () => MODAL),
      ...Array.from({ length: 6 }, () => MAY),
    ],
  });

  const SETUP = {
    seed: 'modal-and-may/v0',
    decks: [deck('Recruits'), deck('Mercies')] as const,
    // 12 was tried first and never once put a MAY card in the human's hand
    // before the turn limit ended the game (confirmed by instrumenting the
    // driver loop): the "you may" spell is checked to fire below, so a turn
    // limit that lets it go unseen would make that assertion vacuous rather
    // than green. 20 was verified empirically, at this seed, to reach five
    // "may" decisions by turn 15, well inside the margin.
    maximumTurns: 20,
  };

  const seats = () => [humanSeat('person'), botSeat(simpleAgent('bot'))] as const;

  /** Every `mode`-bearing castSpell chosen, and every `may` decision reached. */
  function playToTheEnd(): {
    readonly session: GameSession;
    readonly modesCast: number;
    readonly maysAsked: number;
  } {
    let session: GameSession = createSession(SETUP, seats());
    let modesCast = 0;
    let maysAsked = 0;
    for (let guard = 0; guard < 20_000; guard += 1) {
      const decision = session.pending;
      if (decision === null) return { session, modesCast, maysAsked };
      if (decision.kind === 'may') maysAsked += 1;
      const index = decision.kind === 'mulligan' ? 0 : decision.options.length - 1;
      const chosen = decision.options[index];
      if (chosen?.type === 'castSpell' && chosen.mode !== undefined) modesCast += 1;
      session = choose(session, index);
    }
    throw new Error('the session never stopped asking');
  }

  const played = playToTheEnd();

  it('asks the may question during the game', () => {
    // Not vacuous: the whole replay assertion below is worthless if a "you
    // may" spell never actually paused the game.
    expect(played.maysAsked, 'the "you may" spell was never asked about').toBeGreaterThan(0);
    expect(eventsOfType(played.session.events, 'spellDeclined').length).toBeGreaterThan(0);
  });

  it('replays into the same events, choices, position and result', () => {
    const replayed = replaySession(SETUP, seats(), played.session.choices, {});

    expect(replayed.choices).toEqual(played.session.choices);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.session.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.session.state));
    expect(replayed.result).toEqual(played.session.result);
    expect(replayed.decisions).toBe(played.session.decisions);
  });

  it('plays the same game twice from the same seed', () => {
    expect(JSON.stringify(playToTheEnd().session.choices)).toBe(JSON.stringify(played.session.choices));
  });
});
