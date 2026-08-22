/**
 * Attack-policy unit tests on constructed board states.
 *
 * Every case states the position, the heuristic under test, and the expected
 * declaration. Nothing here plays a whole game: `scenario` builds the board and
 * the policy is called directly, so a failure names the heuristic that broke.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { combatDefenders, eligibleAttackers, scenario } from '@mtg/kernel';
import type { GameState, ObjectId } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, chooseAttackers, greedyConfig } from '@mtg/sim';
import { creature, creatureWithStatic } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

function attackersFor(state: GameState, overrides = config): readonly ObjectId[] {
  return chooseAttackers(state, 0, eligibleAttackers(state), overrides).map((declaration) => declaration.oid);
}

function nameOf(state: GameState, oid: ObjectId): string {
  return state.objects[oid]?.card.name ?? '?';
}

describe('attack policy', () => {
  it('attacks a planeswalker it can remove and otherwise keeps pressure on the player', () => {
    const walker = parseCard({
      kind: 'planeswalker',
      id: 'bot-attack-walker',
      name: 'Tactical Arbiter',
      rarity: 'rare',
      set: { code: 'BOT', collectorNumber: 1 },
      manaCost: { generic: 3 },
      colors: [],
      supertypes: ['legendary'],
      subtypes: ['Tactician'],
      startingLoyalty: 3,
    });
    const strong = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Closer', 4, 4), controller: 0 },
        { card: walker, controller: 1 },
      ],
    }).state;
    const strongAttack = chooseAttackers(
      strong,
      0,
      eligibleAttackers(strong),
      config,
      combatDefenders(strong, 0),
    );
    expect(strongAttack[0]?.defender).toEqual({
      kind: 'planeswalker',
      oid: strong.battlefield.find((oid) => strong.objects[oid]?.card.name === walker.name),
    });

    const weak = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Poke', 2, 2), controller: 0 },
        { card: walker, controller: 1 },
      ],
    }).state;
    expect(
      chooseAttackers(weak, 0, eligibleAttackers(weak), config, combatDefenders(weak, 0))[0]?.defender,
    ).toBe(1);
  });

  it('finishes a lethal player attack before removing a killable planeswalker', () => {
    const walker = parseCard({
      kind: 'planeswalker',
      id: 'bot-lethal-walker',
      name: 'Last-Ditch Arbiter',
      rarity: 'rare',
      set: { code: 'BOT', collectorNumber: 2 },
      manaCost: { generic: 3 },
      colors: [],
      supertypes: ['legendary'],
      subtypes: ['Tactician'],
      startingLoyalty: 3,
    });
    const state = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 3],
      battlefield: [
        { card: creature('Finisher', 4, 4), controller: 0 },
        { card: walker, controller: 1 },
      ],
    }).state;

    const attack = chooseAttackers(state, 0, eligibleAttackers(state), config, combatDefenders(state, 0));
    expect(attack).toHaveLength(1);
    expect(attack[0]?.defender).toBe(1);
  });

  it("swings when the defender's only blocker dies for free", () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Bruiser', 3, 3), controller: 0 },
        { card: creature('Squire', 1, 1), controller: 1 },
      ],
    });
    expect(attackersFor(state).map((oid) => nameOf(state, oid))).toEqual(['Bruiser']);
  });

  it('holds back an attacker that would simply die', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Runt', 2, 2), controller: 0 },
        { card: creature('Colossus', 4, 4), controller: 1 },
      ],
    });
    expect(attackersFor(state)).toEqual([]);
  });

  it('sends a creature that attacks each combat if able into a losing exchange (CR 508.1d)', () => {
    // "Holds back an attacker that would simply die", with the requirement
    // printed on the runt: the policy still scores the attack as a loss, and
    // still has to make it.
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        {
          card: creatureWithStatic('Berserk Runt', 2, 2, { kind: 'attacksEachCombatIfAble' }),
          controller: 0,
        },
        { card: creature('Colossus', 4, 4), controller: 1 },
      ],
    });
    expect(attackersFor(state).map((oid) => nameOf(state, oid))).toEqual(['Berserk Runt']);
  });

  it('keeps the compelled attacker when the race guard sends the rest home', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [6, 20],
      battlefield: [
        {
          card: creatureWithStatic('Berserk Runt', 2, 2, { kind: 'attacksEachCombatIfAble' }),
          controller: 0,
        },
        { card: creature('Guard', 3, 3), controller: 0 },
        { card: creature('Raider A', 4, 4), controller: 1 },
        { card: creature('Raider B', 4, 4), controller: 1 },
      ],
    });
    expect(attackersFor(state).map((oid) => nameOf(state, oid))).toEqual(['Berserk Runt']);
  });

  it('attacks into a bigger creature when first strike wins the exchange', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Duelist', 3, 2, ['firstStrike']), controller: 0 },
        { card: creature('Brute', 2, 3), controller: 1 },
      ],
    });
    expect(attackersFor(state).map((oid) => nameOf(state, oid))).toEqual(['Duelist']);
  });

  it('swings with everything for lethal even when the attack is a losing trade', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 3],
      battlefield: [
        { card: creature('Pauper A', 2, 2), controller: 0 },
        { card: creature('Pauper B', 2, 2), controller: 0 },
        { card: creature('Wall', 0, 6), controller: 1, tapped: true },
      ],
    });
    expect(attackersFor(state)).toHaveLength(2);
  });

  it('keeps a blocker home when the opponent can race us', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [2, 20],
      battlefield: [
        { card: creature('Charger A', 3, 3), controller: 0 },
        { card: creature('Charger B', 3, 3), controller: 0 },
        { card: creature('Charger C', 3, 3), controller: 0 },
        { card: creature('Raider', 2, 2), controller: 1 },
      ],
    });
    // Every attack is profitable, but one body must stay home to answer the
    // 2-power attacker against our 2 life.
    expect(attackersFor(state)).toHaveLength(2);
  });

  it('never holds a vigilance creature back, because attacking costs it nothing', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [2, 20],
      battlefield: [
        { card: creature('Sentinel', 3, 3, ['vigilance']), controller: 0 },
        { card: creature('Raider', 2, 2), controller: 1 },
      ],
    });
    expect(attackersFor(state).map((oid) => nameOf(state, oid))).toEqual(['Sentinel']);
  });

  it('turns the race guard off when the profile says so', () => {
    const reckless = greedyConfig({ attack: { defensiveThreatRatio: Number.POSITIVE_INFINITY } });
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [2, 20],
      battlefield: [
        { card: creature('Charger A', 3, 3), controller: 0 },
        { card: creature('Charger B', 3, 3), controller: 0 },
        { card: creature('Raider', 2, 2), controller: 1 },
      ],
    });
    expect(attackersFor(state, reckless)).toHaveLength(2);
  });

  it('respects flying: a grounded blocker does not make an attack unprofitable', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Drake', 2, 2, ['flying']), controller: 0 },
        { card: creature('Ogre', 4, 4), controller: 1 },
      ],
    });
    expect(attackersFor(state).map((oid) => nameOf(state, oid))).toEqual(['Drake']);
  });
});
