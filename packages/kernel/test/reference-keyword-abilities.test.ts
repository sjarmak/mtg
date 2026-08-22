import { parseCard, type Card, type InstantCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  canBlock,
  checkStateBasedActions,
  cleanupTurnEffects,
  collectTriggers,
  destroyPermanent,
  eligibleAttackers,
  eventsOfType,
  isLegalAuraHost,
  moveObject,
  onlyObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  stateFingerprint,
  targetChoicesFor,
  targetChoicesForEffects,
  triggerOnStack,
  triggerTargetChoices,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { FOREST, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';
import { recolor, retype } from './continuous-helpers';

let collector = 0;

function creature(
  name: string,
  options: {
    readonly colors?: readonly ('W' | 'U' | 'B' | 'R' | 'G')[];
    readonly subtypes?: readonly string[];
    readonly keywordAbilities?: readonly unknown[];
    readonly abilities?: readonly unknown[];
    readonly power?: number;
    readonly toughness?: number;
  } = {},
): Card {
  collector += 1;
  return parseCard({
    kind: 'creature',
    id: `reference-keyword-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'REF', collectorNumber: collector },
    manaCost: options.colors?.[0] === undefined ? { generic: 2 } : { [options.colors[0]]: 2 },
    colors: [...(options.colors ?? [])],
    subtypes: [...(options.subtypes ?? [])],
    power: options.power ?? 2,
    toughness: options.toughness ?? 2,
    keywordAbilities: [...(options.keywordAbilities ?? [])],
    abilities: [...(options.abilities ?? [])],
  });
}

function damageSpell(name: string, color: 'W' | 'B'): InstantCard {
  collector += 1;
  const card = parseCard({
    kind: 'instant',
    id: `reference-spell-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'REF', collectorNumber: collector },
    manaCost: { [color]: 1 },
    colors: [color],
    effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
  });
  if (card.kind !== 'instant') throw new Error(`${name} did not parse as an instant`);
  return card;
}

const defender = creature('Exact Defender', { keywordAbilities: [{ kind: 'defender' }] });
const swampwalker = creature('Exact Swampwalker', {
  keywordAbilities: [{ kind: 'landwalk', landType: 'Swamp' }],
});
const hexproof = creature('Exact Hexproof', { keywordAbilities: [{ kind: 'hexproof' }] });
const protectedFromBlack = creature('Exact Protection', {
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'B' } }],
});
const protectedFromWhite = creature('Exact White Protection', {
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'W' } }],
});
const indestructible = creature('Exact Indestructible', {
  keywordAbilities: [{ kind: 'indestructible' }],
});
const regenerator = creature('Exact Regenerator', {
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { G: 1 } },
      regenerateSelf: true,
      effects: [],
    },
  ],
});
const blackCreature = creature('Black Dragon', { colors: ['B'], subtypes: ['Dragon'] });
const blackDamage = damageSpell('Black Damage', 'B');
const whiteDamage = damageSpell('White Damage', 'W');

describe('defender and landwalk', () => {
  it('keeps defender out of attackers without taking away its blocking legality', () => {
    const start = scenario({
      battlefield: [
        { card: defender, controller: 0 },
        { card: creature('Ordinary Attacker'), controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    expect(eligibleAttackers(start.state)).not.toContain(oidOf(start.state, 'Exact Defender'));
  });

  it('prevents blocks only while the defending player controls the named basic land type', () => {
    const withSwamp = scenario({
      battlefield: [
        { card: swampwalker, controller: 0 },
        { card: creature('Swamp Blocker'), controller: 1 },
        { card: SWAMP, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    expect(
      canBlock(
        withSwamp.state,
        oidOf(withSwamp.state, 'Swamp Blocker'),
        oidOf(withSwamp.state, 'Exact Swampwalker'),
      ),
    ).toBe(false);

    const withoutSwamp = scenario({
      battlefield: [
        { card: swampwalker, controller: 0 },
        { card: creature('Forest Blocker'), controller: 1 },
        { card: FOREST, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    expect(
      canBlock(
        withoutSwamp.state,
        oidOf(withoutSwamp.state, 'Forest Blocker'),
        oidOf(withoutSwamp.state, 'Exact Swampwalker'),
      ),
    ).toBe(true);
  });
});

describe('hexproof and protection', () => {
  it('lets a controller target their hexproof creature and refuses an opponent', () => {
    const start = scenario({
      battlefield: [{ card: hexproof, controller: 0 }],
      hands: [[whiteDamage], [blackDamage]],
      active: 0,
    });
    const target = oidOf(start.state, 'Exact Hexproof');
    const friendly = handOidOf(start.state, 0, 'White Damage');
    const hostile = handOidOf(start.state, 1, 'Black Damage');
    expect(targetChoicesFor(start.state, whiteDamage, 0, friendly)[0]).toContainEqual({
      kind: 'permanent',
      oid: target,
    });
    expect(targetChoicesFor(start.state, blackDamage, 1, hostile)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: target,
    });
  });

  it('applies Protection separately to targeting, blocking, damage, and Aura attachment', () => {
    const aura = parseCard({
      kind: 'enchantment',
      id: 'black-reference-aura',
      name: 'Black Reference Aura',
      rarity: 'common',
      set: { code: 'REF', collectorNumber: 90 },
      manaCost: { B: 1 },
      colors: ['B'],
      subtypes: ['Aura'],
      aura: { enchant: 'creature', modifications: [{ kind: 'cantBlock' }] },
    });
    const start = scenario({
      battlefield: [
        { card: protectedFromBlack, controller: 0 },
        { card: blackCreature, controller: 1 },
      ],
      hands: [[], [blackDamage]],
      active: 1,
    });
    const protectedOid = oidOf(start.state, 'Exact Protection');
    const blackOid = oidOf(start.state, 'Black Dragon');
    const spellOid = handOidOf(start.state, 1, 'Black Damage');

    expect(targetChoicesFor(start.state, blackDamage, 1, spellOid)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: protectedOid,
    });
    expect(canBlock(start.state, blackOid, protectedOid)).toBe(false);
    expect(isLegalAuraHost(start.state, aura, protectedOid)).toBe(true);
    expect(targetChoicesFor(start.state, aura, 1)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: protectedOid,
    });

    const damaged = applyDamage(beginTrace(start.state), [
      {
        sourceOid: blackOid,
        controller: 1,
        recipient: { kind: 'permanent', oid: protectedOid },
        amount: 2,
        deathtouch: false,
        lifelink: false,
        combat: false,
      },
    ]);
    expect(damaged.state.objects[protectedOid]?.damage).toBe(0);
    expect(eventsOfType(damaged.events, 'damagePrevented')).toHaveLength(1);
  });

  it('filters controller-restricted targets through Protection too', () => {
    const whiteSource = creature('White Targeting Source', { colors: ['W'] });
    const start = scenario({
      battlefield: [
        { card: whiteSource, controller: 0 },
        { card: protectedFromWhite, controller: 0 },
      ],
    });
    const target = oidOf(start.state, 'Exact White Protection');
    const source = oidOf(start.state, 'White Targeting Source');
    const choices = targetChoicesForEffects(
      start.state,
      [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
      0,
      source,
    );
    expect(choices[0]).not.toContainEqual({ kind: 'permanent', oid: target });
  });

  it('uses a triggered ability source rather than its synthetic stack id for Protection', () => {
    const source = creature('White Trigger Source', {
      colors: ['W'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const start = scenario({
      battlefield: [
        { card: source, controller: 1 },
        { card: protectedFromWhite, controller: 0 },
      ],
    });
    const sourceOid = oidOf(start.state, 'White Trigger Source');
    const protectedOid = oidOf(start.state, 'Exact White Protection');
    const entry = {
      oid: 'ab-reference-protection',
      controller: 1 as const,
      targets: [{ kind: 'permanent' as const, oid: protectedOid }],
      ability: { sourceOid, index: 0 },
      mode: null,
      triggerContext: null,
      x: null,
      sourceCharacteristics: null,
    };
    const state = { ...start.state, stack: [entry] };
    const pending = triggerOnStack(state, entry.oid);
    if (pending === null) throw new Error('reference trigger was not on the stack');

    expect(triggerTargetChoices(state, pending)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: protectedOid,
    });
    const resolved = resolveTop(beginTrace(state));
    expect(resolved.state.objects[protectedOid]?.zone).toBe('battlefield');
    expect(eventsOfType(resolved.events, 'effectSkipped')).toHaveLength(1);
  });

  it('uses copied spell characteristics when Protection rechecks its target', () => {
    const start = scenario({ battlefield: [{ card: protectedFromBlack, controller: 0 }] });
    const protectedOid = oidOf(start.state, 'Exact Protection');
    const entry = {
      oid: 'cp-reference-protection',
      controller: 1 as const,
      targets: [{ kind: 'permanent' as const, oid: protectedOid }],
      ability: null,
      mode: null,
      triggerContext: null,
      x: null,
      sourceCharacteristics: null,
      copiedSpell: {
        card: blackDamage,
        copiedFrom: 'o-reference-original',
        sourceOid: 'o-reference-original',
      },
    };
    const resolved = resolveTop(beginTrace({ ...start.state, stack: [entry] }));
    expect(resolved.state.objects[protectedOid]?.damage).toBe(0);
    expect(eventsOfType(resolved.events, 'spellFizzled')).toHaveLength(1);
  });

  it('retains changed color and subtype as source LKI after a trigger source leaves', () => {
    const departed = creature('Printed Green Trigger Source', {
      colors: ['G'],
      subtypes: ['Elf'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const protectedTarget = creature('LKI-Protected Target', {
      keywordAbilities: [
        { kind: 'protection', quality: { kind: 'color', color: 'W' } },
        { kind: 'protection', quality: { kind: 'subtype', subtype: 'Dragon' } },
      ],
    });
    const start = scenario({
      battlefield: [
        { card: departed, controller: 1 },
        { card: protectedTarget, controller: 0 },
      ],
    });
    const sourceOid = oidOf(start.state, 'Printed Green Trigger Source');
    const protectedOid = oidOf(start.state, 'LKI-Protected Target');
    const changed = {
      ...start.state,
      continuous: [
        recolor(onlyObject(sourceOid), ['W']),
        retype(onlyObject(sourceOid), { addSubtypes: ['Dragon'] }),
      ],
    };
    const departedTrace = moveObject(beginTrace(changed), sourceOid, 'graveyard');
    const gone = departedTrace.state;
    expect(gone.objects[sourceOid]?.lastKnownSourceCharacteristics).toEqual({
      colors: ['W'],
      subtypes: ['Elf', 'Dragon'],
    });
    const triggered = putTriggersOnStack(departedTrace, collectTriggers(departedTrace, 0));
    expect(triggered.state.stack[0]?.sourceCharacteristics).toEqual({
      colors: ['W'],
      subtypes: ['Elf', 'Dragon'],
    });
    for (const sourceCharacteristics of [
      { colors: ['W'] as const, subtypes: ['Elf'] },
      { colors: ['G'] as const, subtypes: ['Dragon'] },
    ]) {
      const entry = {
        oid: `ab-lki-${sourceCharacteristics.colors[0]}`,
        controller: 1 as const,
        targets: [{ kind: 'permanent' as const, oid: protectedOid }],
        ability: { sourceOid, index: 0 },
        mode: null,
        triggerContext: null,
        x: null,
        sourceCharacteristics,
      };
      const state = { ...gone, stack: [entry] };
      const pending = triggerOnStack(state, entry.oid);
      if (pending === null) throw new Error('LKI trigger was not on the stack');
      expect(triggerTargetChoices(state, pending)[0]).not.toContainEqual({
        kind: 'permanent',
        oid: protectedOid,
      });
      expect(eventsOfType(resolveTop(beginTrace(state)).events, 'effectSkipped')).toHaveLength(1);
      expect(stateFingerprint(state)).not.toBe(
        stateFingerprint({ ...state, stack: [{ ...entry, sourceCharacteristics: null }] }),
      );
    }
  });

  it('captures changed source characteristics before a self-sacrifice activation cost', () => {
    const source = creature('LKI Sacrifice Source', {
      colors: ['G'],
      subtypes: ['Elf'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, sacrificeSelf: true },
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const start = scenario({
      battlefield: [
        { card: source, controller: 0 },
        { card: creature('LKI Activation Target'), controller: 1 },
      ],
    });
    const sourceOid = oidOf(start.state, 'LKI Sacrifice Source');
    const targetOid = oidOf(start.state, 'LKI Activation Target');
    const changed = {
      ...start.state,
      continuous: [
        recolor(onlyObject(sourceOid), ['W']),
        retype(onlyObject(sourceOid), { addSubtypes: ['Dragon'] }),
      ],
    };
    const activated = apply(
      { state: changed, events: [] },
      {
        type: 'activateAbility',
        player: 0,
        oid: sourceOid,
        abilityIndex: 0,
        targets: [{ kind: 'permanent', oid: targetOid }],
        sacrifices: [],
      },
    );
    expect(activated.state.objects[sourceOid]?.zone).toBe('graveyard');
    expect(activated.state.stack[0]?.sourceCharacteristics).toEqual({
      colors: ['W'],
      subtypes: ['Elf', 'Dragon'],
    });
  });
});

describe('indestructible and regeneration', () => {
  it('stops destruction and lethal damage but not the zero-toughness state-based action', () => {
    const start = scenario({ battlefield: [{ card: indestructible, controller: 0 }] });
    const oid = oidOf(start.state, 'Exact Indestructible');
    const destroyed = destroyPermanent(beginTrace(start.state), oid, 'destroyEffect');
    expect(destroyed.state.objects[oid]?.zone).toBe('battlefield');

    const lethal = checkStateBasedActions(
      beginTrace({
        ...start.state,
        objects: { ...start.state.objects, [oid]: { ...start.state.objects[oid]!, damage: 2 } },
      }),
    );
    expect(lethal.state.objects[oid]?.zone).toBe('battlefield');

    const zero = checkStateBasedActions(
      beginTrace({
        ...start.state,
        continuous: [
          {
            id: 'zero-toughness',
            kind: 'ptMod',
            layer: '7c',
            affects: {
              oids: [oid],
              excludeOids: null,
              cardTypes: null,
              allCardTypes: null,
              excludeCardTypes: null,
              subtypes: null,
              supertypes: null,
              colors: null,
              excludeColors: null,
              keywords: null,
              controller: null,
              controllerIsSource: false,
            },
            power: 0,
            toughness: -2,
            duration: 'permanent',
            enabledWhile: null,
            timestamp: 1,
            sourceOid: oid,
          },
        ],
      }),
    );
    expect(zero.state.objects[oid]?.zone).toBe('graveyard');
  });

  it('creates one expiring shield that taps, removes from combat, and clears damage', () => {
    let current = scenario({
      battlefield: [
        { card: regenerator, controller: 0, damage: 1 },
        { card: FOREST, controller: 0 },
      ],
      active: 0,
    });
    const oid = oidOf(current.state, 'Exact Regenerator');
    const forest = oidOf(current.state, 'Forest');
    current = apply(current, { type: 'activateManaAbility', player: 0, oid: forest, color: 'G' });
    current = apply(current, {
      type: 'activateAbility',
      player: 0,
      oid,
      abilityIndex: 0,
      targets: [],
      sacrifices: [],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });

    const combatState = {
      ...current.state,
      combat: {
        ...current.state.combat,
        attacks: [{ oid, defender: 1 as const }],
      },
    };
    const saved = destroyPermanent(beginTrace(combatState), oid, 'destroyEffect');
    expect(saved.state.objects[oid]).toEqual(
      expect.objectContaining({ zone: 'battlefield', tapped: true, damage: 0 }),
    );
    expect(saved.state.combat.attacks).toEqual([]);
    expect(eventsOfType(saved.events, 'permanentRegenerated')).toHaveLength(1);

    const second = destroyPermanent(saved, oid, 'destroyEffect');
    expect(second.state.objects[oid]?.zone).toBe('graveyard');

    const fresh = cleanupTurnEffects(beginTrace(current.state));
    expect(fresh.state.replacements).toHaveLength(0);
  });
});
