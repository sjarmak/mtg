/** Native source-color targeting proofs for M11 Gaea's Revenge. */
import { parseCard, type Card, type InstantCard } from '@mtg/dsl';
import {
  beginTrace,
  canBeTargetedBy,
  characteristicsOf,
  eligibleAttackers,
  eventsOfType,
  onlyObject,
  resolveTop,
  scenario,
  targetChoicesFor,
  targetChoicesForEffects,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { handOidOf, oidOf } from './helpers';
import { abilities, copies, recolor } from './continuous-helpers';

let collector = 0;

function creature(
  name: string,
  color: 'U' | 'G',
  options: { readonly abilities?: readonly unknown[] } = {},
): Card {
  collector += 1;
  return parseCard({
    kind: 'creature',
    id: `gaeas-revenge-creature-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { [color]: 1 },
    colors: [color],
    power: 2,
    toughness: 2,
    abilities: [...(options.abilities ?? [])],
  });
}

function damageSpell(name: string, color: 'U' | 'G'): InstantCard {
  collector += 1;
  const card = parseCard({
    kind: 'instant',
    id: `gaeas-revenge-spell-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { [color]: 1 },
    colors: [color],
    effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
  });
  if (card.kind !== 'instant') throw new Error(`${name} did not parse as an instant`);
  return card;
}

const GAEAS_REVENGE = parseCard({
  kind: 'creature',
  id: 'm11-174-gaeas-revenge-kernel',
  name: "Gaea's Revenge",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 174 },
  manaCost: { generic: 5, G: 2 },
  colors: ['G'],
  subtypes: ['Elemental'],
  power: 8,
  toughness: 5,
  keywords: ['haste'],
  cannotBeCountered: true,
  targetingRestrictions: [{ kind: 'sourceLacksColor', color: 'G' }],
});

const BLUE_DAMAGE = damageSpell('Blue Revenge Probe', 'U');
const GREEN_DAMAGE = damageSpell('Green Revenge Probe', 'G');
const COLORLESS_DAMAGE = parseCard({
  kind: 'instant',
  id: 'gaeas-revenge-colorless-spell',
  name: 'Colorless Revenge Probe',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 90 },
  manaCost: { generic: 1 },
  colors: [],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
});
const MULTICOLORED_DAMAGE = parseCard({
  kind: 'instant',
  id: 'gaeas-revenge-multicolored-spell',
  name: 'Multicolored Revenge Probe',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 91 },
  manaCost: { U: 1, G: 1 },
  colors: ['U', 'G'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
});

function aura(name: string, color: 'U' | 'G', collectorNumber: number): Card {
  return parseCard({
    kind: 'enchantment',
    id: `gaeas-revenge-${color.toLowerCase()}-aura`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { [color]: 1 },
    colors: [color],
    subtypes: ['Aura'],
    aura: { enchant: 'creature', modifications: [{ kind: 'cantBlock' }] },
  });
}

const BLUE_AURA = aura('Blue Revenge Aura', 'U', 92);
const GREEN_AURA = aura('Green Revenge Aura', 'G', 93);
const BLUE_SOURCE = creature('Blue Ability Source', 'U');
const GREEN_SOURCE = creature('Green Ability Source', 'G');

describe("Gaea's Revenge source-color targeting restriction", () => {
  it('refuses nongreen spells and abilities while allowing green sources from either controller', () => {
    const start = scenario({
      battlefield: [
        { card: GAEAS_REVENGE, controller: 0 },
        { card: BLUE_SOURCE, controller: 0 },
        { card: GREEN_SOURCE, controller: 1 },
      ],
      hands: [
        [BLUE_DAMAGE, COLORLESS_DAMAGE],
        [GREEN_DAMAGE, MULTICOLORED_DAMAGE, BLUE_AURA, GREEN_AURA],
      ],
    });
    const target = oidOf(start.state, GAEAS_REVENGE.name);
    const blueSpell = handOidOf(start.state, 0, BLUE_DAMAGE.name);
    const greenSpell = handOidOf(start.state, 1, GREEN_DAMAGE.name);
    const colorlessSpell = handOidOf(start.state, 0, COLORLESS_DAMAGE.name);
    const multicoloredSpell = handOidOf(start.state, 1, MULTICOLORED_DAMAGE.name);
    const blueAura = handOidOf(start.state, 1, BLUE_AURA.name);
    const greenAura = handOidOf(start.state, 1, GREEN_AURA.name);

    expect(targetChoicesFor(start.state, BLUE_DAMAGE, 0, blueSpell)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: target,
    });
    expect(targetChoicesFor(start.state, GREEN_DAMAGE, 1, greenSpell)[0]).toContainEqual({
      kind: 'permanent',
      oid: target,
    });
    expect(targetChoicesFor(start.state, COLORLESS_DAMAGE, 0, colorlessSpell)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: target,
    });
    expect(targetChoicesFor(start.state, MULTICOLORED_DAMAGE, 1, multicoloredSpell)[0]).toContainEqual({
      kind: 'permanent',
      oid: target,
    });
    expect(targetChoicesFor(start.state, BLUE_AURA, 1, blueAura)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: target,
    });
    expect(targetChoicesFor(start.state, GREEN_AURA, 1, greenAura)[0]).toContainEqual({
      kind: 'permanent',
      oid: target,
    });

    const effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } as const;
    expect(
      targetChoicesForEffects(start.state, [effect], 0, oidOf(start.state, BLUE_SOURCE.name))[0],
    ).not.toContainEqual({ kind: 'permanent', oid: target });
    expect(
      targetChoicesForEffects(start.state, [effect], 1, oidOf(start.state, GREEN_SOURCE.name))[0],
    ).toContainEqual({ kind: 'permanent', oid: target });
  });

  it('rechecks the live color of an ability source and fizzles after it becomes nongreen', () => {
    const source = creature('Changing Ability Source', 'G', {
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const start = scenario({
      battlefield: [
        { card: GAEAS_REVENGE, controller: 0 },
        { card: source, controller: 1 },
      ],
    });
    const target = oidOf(start.state, GAEAS_REVENGE.name);
    const sourceOid = oidOf(start.state, source.name);
    const entry = {
      oid: 'ab-gaeas-revenge-color-change',
      controller: 1 as const,
      targets: [{ kind: 'permanent' as const, oid: target }],
      ability: { sourceOid, index: 0 },
      mode: null,
      triggerContext: null,
      x: null,
      sourceCharacteristics: null,
    };
    const state = {
      ...start.state,
      continuous: [recolor(onlyObject(sourceOid), ['U'])],
      stack: [entry],
    };
    const resolved = resolveTop(beginTrace(state));

    expect(resolved.state.objects[target]?.zone).toBe('battlefield');
    expect(eventsOfType(resolved.events, 'effectSkipped')).toHaveLength(1);
  });

  it('uses copied spell characteristics when rechecking the target', () => {
    const start = scenario({ battlefield: [{ card: GAEAS_REVENGE, controller: 0 }] });
    const target = oidOf(start.state, GAEAS_REVENGE.name);
    const entry = {
      oid: 'cp-gaeas-revenge-blue-spell',
      controller: 1 as const,
      targets: [{ kind: 'permanent' as const, oid: target }],
      ability: null,
      mode: null,
      triggerContext: null,
      x: null,
      sourceCharacteristics: null,
      copiedSpell: {
        card: BLUE_DAMAGE,
        copiedFrom: 'o-gaeas-revenge-original',
        sourceOid: 'o-gaeas-revenge-original',
      },
    };
    const resolved = resolveTop(beginTrace({ ...start.state, stack: [entry] }));

    expect(resolved.state.objects[target]?.damage).toBe(0);
    expect(eventsOfType(resolved.events, 'spellFizzled')).toHaveLength(1);
  });

  it('copies the restriction in layer 1 and removes it with all other abilities in layer 6', () => {
    const ordinary = creature('Revenge Copy Body', 'G');
    const start = scenario({
      battlefield: [
        { card: GAEAS_REVENGE, controller: 0 },
        { card: ordinary, controller: 0 },
        { card: BLUE_SOURCE, controller: 1 },
      ],
    });
    const revenge = oidOf(start.state, GAEAS_REVENGE.name);
    const copy = oidOf(start.state, ordinary.name);
    const blue = oidOf(start.state, BLUE_SOURCE.name);
    const copiedState = { ...start.state, continuous: [copies(onlyObject(copy), revenge)] };
    const silencedState = {
      ...start.state,
      continuous: [abilities(onlyObject(revenge), { removeAll: true })],
    };

    expect(characteristicsOf(copiedState, copy).targetingRestrictions).toEqual([
      { kind: 'sourceLacksColor', color: 'G' },
    ]);
    expect(canBeTargetedBy(copiedState, copy, blue, 1)).toBe(false);
    expect(characteristicsOf(silencedState, revenge).targetingRestrictions).toEqual([]);
    expect(canBeTargetedBy(silencedState, revenge, blue, 1)).toBe(true);
  });

  it('can attack on the turn it enters because the exact card retains haste', () => {
    const start = scenario({
      battlefield: [{ card: GAEAS_REVENGE, controller: 0 }],
      active: 0,
      step: 'declareAttackers',
    });
    expect(eligibleAttackers(start.state)).toContain(oidOf(start.state, GAEAS_REVENGE.name));
  });
});
