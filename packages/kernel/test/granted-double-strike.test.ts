/**
 * A resolved effect that hands a whole group double strike (`mtg-nhyv.63`).
 *
 * M13's Cleaver Riot is "creatures you control gain double strike until end of
 * turn", and every part of that sentence was already expressible except one
 * word. `grantKeywordUntilEndOfTurn` carried the `permanentsYouControl` scope
 * from `mtg-nhyv.15`, `mtg-nhyv.74` built `GRANTABLE_KEYWORD_ABILITY_KINDS` so
 * a grant could name something outside the evergreen nine, and `combat.ts` has
 * run both damage steps since the kernel had a combat phase. What was missing
 * is that the *static* grant read `GrantableKeywordSchema` and the *effect*
 * still read `KeywordSchema` — one sentence in two durations reaching two
 * vocabularies, which is an asymmetry rather than a rule.
 *
 * ## Why these claims and not a characteristic read
 *
 * Widening the field is the cheap half. The dangerous half is the list the
 * kernel writes the name into: `Characteristics` keeps `keywords` and
 * `keywordAbilities` apart because their rules consequences differ, and every
 * rule that consumes double strike — `combat.ts` at the first-strike check and
 * again at the regular one — asks `hasKeywordAbility`. A grant written into
 * `keywords` beside haste validates, renders, exports to Forge and is then
 * disregarded by the only code that would have made it mean anything. So the
 * claims below are damage totals and damage *steps*, which is what a player
 * would see, and `granted-indestructible.test.ts` made the identical argument
 * about deaths and survivals for the same reason.
 *
 * Measured while writing this file: routing the grant into `addKeywords`
 * instead of `addKeywordAbilities` leaves the card validating and the printed
 * sentence unchanged, and fails four of the seven claims here — the list
 * claim, both damage claims and the expiry claim, which reads the grant as
 * present before it checks that it is gone. The three that keep passing are
 * the ones that would pass on a kernel with no grant at all: the card still
 * validates, the unbuffed attack is still one step, and the creature across
 * the table still gains nothing. That is the counterfactual, and it is why the
 * arm in `effects.ts` asks `isGrantableKeywordAbilityKind` rather than
 * assuming the name is one of the nine.
 *
 * The unbuffed attack is the negative control on every damage claim. A kernel
 * that had started running two combat damage steps unconditionally, or that
 * granted double strike to the whole board rather than to one seat's creatures,
 * passes a file that never attacks without the spell.
 */
import { parseCard, validateCards, type Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  advanceToStep,
  eventsOfType,
  hasKeyword,
  hasKeywordAbility,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, MOUNTAIN } from './cards';
import { apply, handOidOf, inGraveyard, oidOf, playCombat } from './helpers';

/**
 * M13 #125, printed in full. `noTarget` plus a space scope is what "creatures
 * you control" is (CR 115.1): the spell chooses nobody, and the group is read
 * off the caster as it resolves.
 */
const CLEAVER_RIOT: Card = parseCard({
  kind: 'sorcery',
  id: 'ref-cleaver-riot',
  name: 'Cleaver Riot',
  rarity: 'uncommon',
  set: { code: 'REF', collectorNumber: 125 },
  manaCost: { generic: 4, R: 1 },
  colors: ['R'],
  effects: [
    {
      kind: 'grantKeywordUntilEndOfTurn',
      keyword: 'doubleStrike',
      target: { kind: 'noTarget' },
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
    },
  ],
});

const RIOTER = creature('Test Rioter', 2, 2);
const RIVAL = creature('Test Rival Bear', 2, 2);
const WALL = creature('Test Wall', 0, 2);

function lands(count: number, controller: 0 | 1): readonly { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

function board(opposition: readonly { card: Card; controller: 0 | 1 }[] = []): ReduceResult {
  return scenario({
    battlefield: [{ card: RIOTER, controller: 0 }, ...opposition, ...lands(5, 0)],
    hands: [[CLEAVER_RIOT], []],
  });
}

/** Casts the sorcery from player 0's hand and passes until it has resolved. */
function castRiot(start: ReduceResult): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, 'Cleaver Riot'),
    targets: [null] as never,
  });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function damageSteps(done: ReduceResult): readonly boolean[] {
  return eventsOfType(done.events, 'combatDamageStep').map((event) => event.firstStrike);
}

/** Idles forward, `grant-keyword-until-end-of-turn.test.ts`'s helper verbatim. */
function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${turn}`);
}

function rioterIn(state: GameState): ObjectId {
  return oidOf(state, 'Test Rioter');
}

describe('Cleaver Riot authored in full', () => {
  it('validates with no violations', () => {
    expect(validateCards([CLEAVER_RIOT])).toEqual([]);
  });

  /**
   * The list claim, and the one the counterfactual is aimed at. Double strike
   * is a keyword *ability*, so a kernel that put it beside haste in `keywords`
   * would answer this pair the other way round and every damage claim below
   * would follow it.
   */
  it('lands in keywordAbilities rather than beside the evergreen nine', () => {
    const start = board();
    const rioter = rioterIn(start.state);
    expect(hasKeywordAbility(start.state, rioter, 'doubleStrike')).toBe(false);

    const done = castRiot(start);

    expect(hasKeywordAbility(done.state, rioter, 'doubleStrike')).toBe(true);
    expect(hasKeyword(done.state, rioter, 'firstStrike')).toBe(false);
    const granted = eventsOfType(done.events, 'keywordGranted');
    expect(granted).toHaveLength(1);
    expect(granted[0]?.targetOid).toBe(rioter);
    expect(granted[0]?.keyword).toBe('doubleStrike');
    expect(granted[0]?.layer).toBe('6');
  });

  it('gives nothing to the creature across the table', () => {
    const done = castRiot(board([{ card: RIVAL, controller: 1 }]));

    expect(hasKeywordAbility(done.state, oidOf(done.state, 'Test Rival Bear'), 'doubleStrike')).toBe(false);
  });
});

describe('the granted double strike in combat', () => {
  /**
   * The negative control. The same 2/2 attacking the same empty board without
   * the spell deals its two damage in one step, so the pair below is the
   * grant's doing rather than the kernel's.
   */
  it('is one step and two damage when the spell was not cast', () => {
    const done = playCombat(advanceToStep(board(), 'declareAttackers'), {
      attackers: [rioterIn(board().state)],
    });

    expect(damageSteps(done)).toEqual([false]);
    expect(done.state.players[1].life).toBe(18);
  });

  it('deals damage in the first-strike step and again in the regular one', () => {
    const start = board();
    const rioter = rioterIn(start.state);

    const done = playCombat(advanceToStep(castRiot(start), 'declareAttackers'), {
      attackers: [rioter],
    });

    expect(damageSteps(done)).toEqual([true, false]);
    expect(done.state.players[1].life).toBe(16);
  });

  /**
   * CR 510.1's ordering said as a board rather than as a step count: the 0/2
   * is dealt two damage while it is still alive, dies to the state-based
   * sweep before the regular step, and the 2/2 that would otherwise have
   * traded with it takes nothing back.
   */
  it('kills its blocker in the first step and takes nothing back in the second', () => {
    const start = board([{ card: WALL, controller: 1 }]);
    const rioter = rioterIn(start.state);
    const wall = oidOf(start.state, 'Test Wall');

    const done = playCombat(advanceToStep(castRiot(start), 'declareAttackers'), {
      attackers: [rioter],
      blocks: [{ blocker: wall, attacker: rioter }],
    });

    expect(damageSteps(done)).toEqual([true, false]);
    expect(inGraveyard(done.state, wall)).toBe(true);
    expect(done.state.objects[rioter]?.zone).toBe('battlefield');
  });
});

describe('and loses it again', () => {
  it('is off the creature on the following turn', () => {
    const start = board();
    const rioter = rioterIn(start.state);

    const done = castRiot(start);
    expect(hasKeywordAbility(done.state, rioter, 'doubleStrike')).toBe(true);

    const later = passUntilTurn(done, done.state.turn.number + 1);

    expect(hasKeywordAbility(later.state, rioter, 'doubleStrike')).toBe(false);
    expect(eventsOfType(later.events, 'continuousEffectsExpired').length).toBeGreaterThan(0);
  });
});
