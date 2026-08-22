/**
 * CR 118.8's toll clause — "…unless its controller pays {2}" — driven through
 * the reducer.
 *
 * `modal-and-may.test.ts` is the file this one stands beside, and the pair is
 * the whole of the spell-level pause mechanism: a "you may" asks the caster's
 * side of the table whether to do the thing, a toll asks the other side
 * whether to stop it. Everything structural is shared — the question arrives
 * as the spell resolves, after CR 608.2b's target recheck and before
 * `resolutionBegan`, and while it stands the kernel accepts nothing but its
 * two answers.
 *
 * What is not shared is where the asked player comes from, and it is the only
 * thing here worth a file of its own. `card.may` names a seat in the abstract
 * (`you`, `opponent`) and `mayChooser` resolves it against the entry's
 * controller. A toll names a *role in the sentence* — "its controller", "that
 * player" — so the seat is read off the spell's chosen target, which means the
 * same printed card charges a different player depending on what it was aimed
 * at, and a card aimed at nothing charges nobody. `unlessPayer` is that
 * derivation and the first three describe blocks are its cases.
 *
 * The last block is the copy case, and it is here because it was a real
 * crash rather than a hypothetical: `resolveTop` calls `spellAwaitingUnless`
 * on every spell it resolves, not only ones already known to print a clause,
 * so reaching the card through the object table threw on the first copied
 * spell any game made (`x-mana.test.ts` made one).
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect, ManaCostInput, UnlessPayer } from '@mtg/dsl';
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

/** An instant that offers the player it is aimed at a price to stop it. */
function tolledInstant(
  name: string,
  effects: readonly Effect[],
  payer: UnlessPayer,
  toll: ManaCostInput = { generic: 2 },
  cost: ManaCostInput = { generic: 1 },
): Card {
  fixtureCounter += 1;
  const manaCost = mana(cost);
  return parseCard({
    kind: 'instant',
    id: `tst-toll-${String(fixtureCounter)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: (fixtureCounter % 900) + 1 },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects,
    unless: { payer, cost: mana(toll) },
  });
}

const DESTROY: readonly Effect[] = [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }];

/** `modal-and-may.test.ts`'s driver: pass priority until the stack empties or the kernel asks something else. */
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

/**
 * Player 0 aims a tolled removal spell at player 1's creature. `payerLands` is
 * how many untapped lands the charged player has, which is the only knob any
 * test below turns: two is enough for the toll, none is not.
 */
function tollBoard(payerLands: number, spell = tolledInstant('Toll of Ruin', DESTROY, 'targetController')) {
  const target = creature('Merfolk Recruit', 2, 2);
  const start = scenario({
    battlefield: [
      { card: target, controller: 1 },
      ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ...lands(FOREST, payerLands).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[spell], []],
  });
  const inHand = start.state.players[0].hand[0];
  if (inHand === undefined) throw new Error('no tolled spell in hand');
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

/** How many of this player's lands are tapped, which is what paying a toll costs. */
function tappedLands(result: ReduceResult, player: 0 | 1): number {
  return result.state.battlefield.filter((oid) => {
    const object = result.state.objects[oid];
    return object?.controller === player && object.card.kind === 'land' && object.tapped;
  }).length;
}

describe('a tolled spell asks the player it is aimed at (CR 118.8)', () => {
  it('pauses for the target’s controller, before resolutionBegan', () => {
    const { cast, spellOid } = tollBoard(2);
    const decision = pendingDecision(cast.state);
    if (decision?.kind !== 'unless') throw new Error('no tolled spell is resolving');
    expect(decision.player).toBe(1);
    expect(decision.oid).toBe(spellOid);
    expect(decision.cost.generic).toBe(2);
    expect(decision.options).toEqual([
      { type: 'answerUnless', player: 1, oid: spellOid, pay: true },
      { type: 'answerUnless', player: 1, oid: spellOid, pay: false },
    ]);
    expect(eventsOfType(cast.events, 'resolutionBegan').some((e) => e.oid === spellOid)).toBe(false);
  });

  it('charges the mana and buries the spell unresolved when the toll is paid', () => {
    const { cast, targetOid, spellOid } = tollBoard(2);
    const paid = apply(cast, { type: 'answerUnless', player: 1, oid: spellOid, pay: true });
    expect(paid.state.objects[targetOid]?.zone).toBe('battlefield');
    expect(paid.state.objects[spellOid]?.zone).toBe('graveyard');
    expect(tappedLands(paid, 1)).toBe(2);
    const said = eventsOfType(paid.events, 'unlessPaid');
    expect(said.length).toBe(1);
    expect(said[0]?.oid).toBe(spellOid);
    expect(said[0]?.player).toBe(1);
    // The toll bought the creature's life, so the spell's effects never ran:
    // `resolutionBegan` is the marker that they were about to.
    expect(eventsOfType(paid.events, 'resolutionBegan').some((e) => e.oid === spellOid)).toBe(false);
  });

  it('resolves exactly as an untolled spell would when the toll is declined', () => {
    const { cast, targetOid, spellOid } = tollBoard(2);
    const declined = apply(cast, { type: 'answerUnless', player: 1, oid: spellOid, pay: false });
    expect(declined.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(tappedLands(declined, 1)).toBe(0);
    expect(eventsOfType(declined.events, 'unlessPaid').length).toBe(0);
    expect(eventsOfType(declined.events, 'resolutionBegan').filter((e) => e.oid === spellOid).length).toBe(1);
  });

  it('refuses every action but the two answers while the question stands', () => {
    const { cast, spellOid, targetOid } = tollBoard(2);
    expect(validateAction(cast.state, { type: 'passPriority', player: 1 })).toBe(
      'you owe a different decision first',
    );
    expect(validateAction(cast.state, { type: 'answerUnless', player: 0, oid: spellOid, pay: true })).toBe(
      "it is player 1's decision",
    );
    expect(validateAction(cast.state, { type: 'answerUnless', player: 1, oid: targetOid, pay: true })).toBe(
      `${spellOid} is the spell resolving, not ${targetOid}`,
    );
    expect(
      validateAction(cast.state, { type: 'answerUnless', player: 1, oid: spellOid, pay: true }),
    ).toBeNull();
    expect(
      validateAction(cast.state, { type: 'answerUnless', player: 1, oid: spellOid, pay: false }),
    ).toBeNull();
  });
});

describe('a toll nobody can pay is not a question', () => {
  it('resolves the spell without ever stopping when the payer has no mana', () => {
    const { cast, targetOid, spellOid } = tollBoard(0);
    // The stack emptied on its own rather than stopping at an 'unless'
    // decision, which is the claim: a one-option question is not asked, so no
    // recorded game carries a choice index for it.
    expect(pendingDecision(cast.state)?.kind).toBe('priority');
    expect(cast.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(eventsOfType(cast.events, 'unlessPaid').length).toBe(0);
    expect(eventsOfType(cast.events, 'resolutionBegan').filter((e) => e.oid === spellOid).length).toBe(1);
  });

  it('asks once the payer can afford it, on the same card and the same board', () => {
    expect(pendingDecision(tollBoard(2).cast.state)?.kind).toBe('unless');
  });
});

describe('the payer is read off the target, not off the card', () => {
  it('charges the player a player-targeting spell names', () => {
    const spell = tolledInstant(
      'Tithe of Ash',
      [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetPlayer' } }],
      'targetPlayer',
    );
    const start = scenario({
      battlefield: [
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
        ...lands(FOREST, 2).map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[spell], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no tolled spell in hand');
    const cast = passUntilQuiet(
      apply(start, {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'player', player: 1 }],
      }),
    );
    const decision = pendingDecision(cast.state);
    if (decision?.kind !== 'unless') throw new Error('no tolled spell is resolving');
    expect(decision.player).toBe(1);

    const paid = apply(cast, { type: 'answerUnless', player: 1, oid: inHand, pay: true });
    expect(paid.state.players[1].life).toBe(20);
    expect(tappedLands(paid, 1)).toBe(2);

    const declined = apply(cast, { type: 'answerUnless', player: 1, oid: inHand, pay: false });
    expect(declined.state.players[1].life).toBe(17);
  });
});

describe('a fizzled tolled spell is never asked (CR 608.2b before CR 118.8)', () => {
  it('bounces the only target in response, and the toll never arrives', () => {
    const spell = tolledInstant('Toll of Ruin', DESTROY, 'targetController');
    const rescue = instant('Rescue', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const bounce = creature('Merfolk Recruit', 2, 2);
    const start = scenario({
      battlefield: [
        { card: bounce, controller: 1 },
        ...lands(FOREST, 3).map((card) => ({ card, controller: 0 as const })),
        ...lands(FOREST, 2).map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[spell, rescue], []],
    });
    const [tollOid, rescueOid] = start.state.players[0].hand;
    if (tollOid === undefined || rescueOid === undefined) throw new Error('hand is short');
    const target = oidOf(start.state, 'Merfolk Recruit');

    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: tollOid,
      targets: [{ kind: 'permanent', oid: target }],
    });
    const responded = apply(cast, {
      type: 'castSpell',
      player: 0,
      oid: rescueOid,
      targets: [{ kind: 'permanent', oid: target }],
    });
    const settled = passUntilQuiet(responded);

    expect(pendingDecision(settled.state)?.kind).toBe('priority');
    expect(eventsOfType(settled.events, 'spellFizzled').some((e) => e.oid === tollOid)).toBe(true);
    expect(eventsOfType(settled.events, 'unlessPaid').length).toBe(0);
    expect(tappedLands(settled, 1)).toBe(0);
  });
});

describe('a copy of a tolled spell carries the toll (CR 707.10)', () => {
  /**
   * The copy is charged on its own terms and the original is charged again
   * after it, which is what "the copy has the same text" costs the player
   * being aimed at: one toll per entry, and paying only one of them still
   * loses the creature. The regression this guards is narrower and worse than
   * that: a copied spell is a stack entry with no object in the table at all,
   * so reading its card through `getObject` threw before the question was even
   * formed.
   */
  it('asks the toll twice, once per entry, and neither answer reaches the object table', () => {
    const spell = tolledInstant('Toll of Ruin', DESTROY, 'targetController', { generic: 1 });
    const target = creature('Merfolk Recruit', 2, 2);
    const start = scenario({
      battlefield: [
        { card: target, controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
        ...lands(FOREST, 2).map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[spell], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no tolled spell in hand');
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
    const withCopy = passUntilQuiet({
      state: copied.state,
      events: [...cast.events, ...copied.events],
    });

    const first = pendingDecision(withCopy.state);
    if (first?.kind !== 'unless') throw new Error('the copy asked no toll');
    expect(first.oid).toBe(copyOid);

    const paidCopy = passUntilQuiet(
      apply(withCopy, { type: 'answerUnless', player: 1, oid: copyOid, pay: true }),
    );
    // A copy ceases to exist rather than going to a graveyard: it was never a
    // card in a zone.
    expect(paidCopy.state.objects[copyOid]).toBeUndefined();

    const second = pendingDecision(paidCopy.state);
    if (second?.kind !== 'unless') throw new Error('the original asked no toll');
    expect(second.oid).toBe(inHand);

    const paidBoth = passUntilQuiet(
      apply(paidCopy, { type: 'answerUnless', player: 1, oid: inHand, pay: true }),
    );
    expect(eventsOfType(paidBoth.events, 'unlessPaid').map((e) => e.oid)).toEqual([copyOid, inHand]);
    expect(paidBoth.state.stack).toHaveLength(0);
    expect(tappedLands(paidBoth, 1)).toBe(2);
    expect(paidBoth.state.objects[targetOid]?.zone).toBe('battlefield');
    expect(paidBoth.state.objects[inHand]?.zone).toBe('graveyard');
  });
});

describe('a recorded game containing a toll decision replays byte for byte', () => {
  /**
   * `modal-and-may.test.ts`'s replay block, aimed at the decision variant this
   * file adds, and non-negotiable for the same reason: a game here is a seed
   * plus a list of small integers, so a toll answer that is not recorded, or
   * that replays in a different order, silently corrupts every recording made
   * since it landed.
   *
   * The human seat takes the *last* enumerated option at every decision but
   * the opening hand (kept at index 0 for `mulligan.ts`'s ordering), which
   * makes every toll it is asked resolve to a refusal: `[pay, decline]` is
   * `unlessDecision`'s fixed order, so "last" is always "no." The bot's side
   * is `simpleAgent`'s own arithmetic, which is the half that can pay.
   *
   * With one exception, and it is the difference between a fixture that
   * contains a toll question and one that cannot: the seat never taps a land
   * for mana it has not been asked to spend. `unless-choice.ts` does not ask a
   * toll the payer cannot afford, and "last option" walked straight into
   * `activateManaAbility` at the first priority window of every turn, floating
   * the seat's whole pool and then losing it to `manaPoolEmptied` at the end of
   * the step. From that moment until its next untap step the seat was tapped
   * out with nothing to show for it, so a toll aimed at its creature resolved
   * as though the clause were not printed. Whether this game contained the
   * decision it exists to record was therefore luck, and it ran out: over 120
   * seeds under the floating driver, two asked a toll at all and neither asked
   * twice. Costs still tap what they need — `castSpell` pays for itself — so
   * dropping the float costs the seat nothing it was using.
   */
  const RECRUIT = creature('Merfolk Recruit', 2, 2, { cost: { generic: 1 } });
  const TOLL = tolledInstant('Toll of Ruin', DESTROY, 'targetController', { generic: 2 }, { generic: 2 });

  const deck = (name: string) => ({
    name,
    cards: [
      ...lands(FOREST, 12),
      ...Array.from({ length: 6 }, () => RECRUIT),
      ...Array.from({ length: 6 }, () => TOLL),
    ],
  });

  const SETUP = {
    seed: 'unless-toll/v0',
    decks: [deck('Tithes'), deck('Recruits')] as const,
    maximumTurns: 20,
  };

  const seats = () => [humanSeat('person'), botSeat(simpleAgent('bot'))] as const;

  /** The last option that is not the seat burning a land for nothing. */
  function lastSpendingNothing(options: readonly Action[]): number {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (options[index]?.type !== 'activateManaAbility') return index;
    }
    return options.length - 1;
  }

  function playToTheEnd(): { readonly session: GameSession; readonly tollsAsked: number } {
    let session: GameSession = createSession(SETUP, seats());
    let tollsAsked = 0;
    for (let guard = 0; guard < 20_000; guard += 1) {
      const decision = session.pending;
      if (decision === null) return { session, tollsAsked };
      if (decision.kind === 'unless') tollsAsked += 1;
      session = choose(session, decision.kind === 'mulligan' ? 0 : lastSpendingNothing(decision.options));
    }
    throw new Error('the session never stopped asking');
  }

  const played = playToTheEnd();

  it('asks the toll during the game', () => {
    // Not vacuous: the replay assertion below proves nothing about this
    // mechanism if no tolled spell ever paused the game.
    expect(played.tollsAsked, 'no tolled spell was ever asked about').toBeGreaterThan(0);
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
