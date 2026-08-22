/**
 * The cards those slots come home with, from the model's answer to the DSL card.
 *
 * `mtg-fv5s`, the other half of `spell-permanent-slots.test.ts`. Everything here
 * is what `assembleCard` and `checkSlotConformance` do with an answer once a
 * batch has been shown the tier that can hold one.
 *
 * The three cards are three shapes, not one shape with fields left out. An Aura
 * says everything it says in a clause, an anthem says it in a static ability,
 * and a walker says it in a list of abilities that carry a loyalty cost instead
 * of a mana cost. They share a card kind pairwise at most, and each crosses into
 * the engine through a different line of `buildCardInput`.
 */
import { describe, expect, it } from 'vitest';
import { assembleCard, checkSlotConformance } from '@mtg/setgen';
import type { FilledCardInput, Slot } from '@mtg/setgen';
import type { Card } from '@mtg/dsl';

/** Every field a slot carries that none of these three tests varies. */
const SLOT_BASE = {
  index: 0,
  collectorNumber: 1,
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  auraModifications: [],
  triggerConditions: [],
  mechanics: [],
  archetypes: [],
  signpost: false,
} as const;

const AURA_SLOT: Slot = {
  ...SLOT_BASE,
  id: 'CW24',
  rarity: 'common',
  color: 'W',
  cardKind: 'enchantment',
  role: 'auraPacify',
  manaValueMin: 1,
  manaValueMax: 3,
  auraModifications: ['cantAttack', 'cantBlock'],
};

const ANTHEM_SLOT: Slot = {
  ...SLOT_BASE,
  id: 'UG08',
  rarity: 'uncommon',
  color: 'G',
  cardKind: 'enchantment',
  role: 'anthem',
  manaValueMin: 2,
  manaValueMax: 4,
  abilityKinds: ['static'],
};

const WALKER_SLOT: Slot = {
  ...SLOT_BASE,
  id: 'RR03',
  rarity: 'rare',
  color: 'R',
  cardKind: 'planeswalker',
  role: 'planeswalker',
  manaValueMin: 3,
  manaValueMax: 5,
  effectKinds: ['dealDamage', 'drawCards', 'createToken'],
  abilityKinds: ['activated'],
};

const FILLED_AURA: FilledCardInput = {
  slotId: AURA_SLOT.id,
  kind: 'enchantment',
  name: 'Sealing Ward',
  manaCost: { generic: 1, W: 1 },
  aura: { enchant: 'creature', modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }] },
  designNote: 'The white common that answers a body without killing it.',
};

const FILLED_ANTHEM: FilledCardInput = {
  slotId: ANTHEM_SLOT.id,
  kind: 'enchantment',
  name: 'Grove Covenant',
  manaCost: { generic: 2, G: 1 },
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
  ],
  designNote: 'A green uncommon that makes a 3/3 for three worth playing.',
};

const FILLED_WALKER: FilledCardInput = {
  slotId: WALKER_SLOT.id,
  kind: 'planeswalker',
  name: 'Ember Sovereign',
  subtype: 'Ember',
  manaCost: { generic: 3, R: 1 },
  startingLoyalty: 4,
  loyaltyAbilities: [
    { loyaltyCost: 1, effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }] },
    { loyaltyCost: -3, effects: [{ kind: 'dealDamage', amount: 4, target: { kind: 'anyTarget' } }] },
  ],
  designNote: 'The red rare a pack is opened for.',
};

/** Assembles or says which violations stopped it, so a failure names its cause. */
function assembled(slot: Slot, filled: FilledCardInput): Card {
  const result = assembleCard(slot, filled as never, 'TST');
  if (result.card === undefined) {
    const detail = result.violations.map((item) => `${item.code} at ${item.path}`).join('; ');
    throw new Error(`${slot.id} did not assemble: ${detail}`);
  }
  return result.card;
}

describe('an Aura', () => {
  const card = assembled(AURA_SLOT, FILLED_AURA);

  it('carries the Aura subtype, which the model was never asked for', () => {
    // `checkSubtypes` admits exactly `['Aura']` on an Aura and nothing on a
    // blanket enchantment, so the clause the model returned already decides the
    // one legal value. A field with one legal value is a field it can only get
    // wrong.
    expect(card.subtypes).toStrictEqual(['Aura']);
    expect(FILLED_AURA).not.toHaveProperty('subtypes');
  });

  it('renders as an Aura reads on a real card', () => {
    expect(card.oracleText).toBe("Enchant creature\nEnchanted creature can't attack or block.");
  });

  it('conforms to the slot that commissioned it', () => {
    expect(checkSlotConformance(AURA_SLOT, card)).toStrictEqual([]);
  });
});

describe('a blanket enchantment', () => {
  const card = assembled(ANTHEM_SLOT, FILLED_ANTHEM);

  it('carries no subtype and no clause', () => {
    expect(card.subtypes).toStrictEqual([]);
    expect(card.kind === 'enchantment' ? card.aura : 'not an enchantment').toBeUndefined();
  });

  it('says what it does by being on the battlefield', () => {
    expect(card.oracleText).toBe('Creatures you control get +1/+1.');
    expect(checkSlotConformance(ANTHEM_SLOT, card)).toStrictEqual([]);
  });
});

describe('a planeswalker', () => {
  const card = assembled(WALKER_SLOT, FILLED_WALKER);

  it('takes its subtype from the character the model named', () => {
    expect(card.subtypes).toStrictEqual(['Ember']);
    expect(card.kind === 'planeswalker' ? card.startingLoyalty : 0).toBe(4);
  });

  it('crosses each loyalty ability into a costless activated ability', () => {
    // CR 606.2: the signed loyalty change is the whole cost, so the model states
    // none and `loyaltyAbilityFromModel` fills the free one. `checkActivatedAbility`
    // refuses a walker ability that states any other cost, so this is the only
    // shape the crossing could have produced.
    for (const ability of card.abilities) {
      expect(ability.kind).toBe('activated');
      if (ability.kind !== 'activated') continue;
      expect(ability.cost.tapSelf).toBe(false);
      expect(ability.cost.sacrificeSelf).toBe(false);
      expect(ability.cost.mana.generic).toBe(0);
      expect(ability.loyaltyCost).not.toBeUndefined();
    }
    expect(
      card.abilities.map((ability) => (ability.kind === 'activated' ? ability.loyaltyCost : 0)),
    ).toStrictEqual([1, -3]);
  });

  it('prints one line the card lives on and one it is played for', () => {
    expect(card.oracleText).toBe(
      '[+1]: Ember Sovereign deals 1 damage to target creature.\n' +
        '[−3]: Ember Sovereign deals 4 damage to any target.',
    );
    expect(checkSlotConformance(WALKER_SLOT, card)).toStrictEqual([]);
  });
});

describe('the clause read back against the slot', () => {
  function codes(slot: Slot, card: Card): string[] {
    return checkSlotConformance(slot, card).map((item) => item.code);
  }

  it('faults an Aura slot whose card came home a blanket enchantment', () => {
    // The two share a card kind and differ only here, so nothing else in
    // conformance can tell them apart: without this check a slot commissioned
    // to answer a creature would ship a lord and pass.
    const blanket = assembled(AURA_SLOT, {
      ...FILLED_ANTHEM,
      slotId: AURA_SLOT.id,
      name: 'Ward Of Nothing',
      manaCost: { generic: 1, W: 1 },
    });
    expect(codes(AURA_SLOT, blanket)).toContain('SLOT_AURA_MISMATCH');
  });

  it('faults a slot that names no clause whose card printed one', () => {
    const clause = assembled(ANTHEM_SLOT, {
      ...FILLED_AURA,
      slotId: ANTHEM_SLOT.id,
      name: 'Grasping Vines',
      manaCost: { generic: 2, G: 1 },
    });
    expect(codes(ANTHEM_SLOT, clause)).toContain('SLOT_AURA_MISMATCH');
  });

  it('faults a clause that modifies something the slot never named', () => {
    const wrong = assembled(AURA_SLOT, {
      ...FILLED_AURA,
      name: 'Ward Of Flight',
      aura: { enchant: 'creature', modifications: [{ kind: 'grantKeyword', keyword: 'flying' }] },
    });
    const findings = checkSlotConformance(AURA_SLOT, wrong);
    expect(findings.map((item) => item.code)).toContain('SLOT_AURA_MISMATCH');
    expect(findings.find((item) => item.code === 'SLOT_AURA_MISMATCH')?.message).toContain('grantKeyword');
  });

  it('compares the kinds and leaves the numbers to the rarity policy', () => {
    // How much an Aura gives is priced elsewhere; which property it changes is
    // what the role decided, and it is the half a regeneration can fix by
    // quoting the slot back.
    const weaken: Slot = { ...AURA_SLOT, role: 'auraWeaken', auraModifications: ['statBonus'] };
    for (const [power, toughness] of [
      [-2, -2],
      [8, 8],
    ] as const) {
      const card = assembled(weaken, {
        ...FILLED_AURA,
        name: `Ward Of ${String(power)}`,
        aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power, toughness }] },
      });
      expect(codes(weaken, card)).toStrictEqual([]);
    }
  });

  it('says nothing about a card that carries no clause in a slot that named none', () => {
    const anthem = assembled(ANTHEM_SLOT, FILLED_ANTHEM);
    expect(codes(ANTHEM_SLOT, anthem)).toStrictEqual([]);
    const walker = assembled(WALKER_SLOT, FILLED_WALKER);
    expect(codes(WALKER_SLOT, walker)).toStrictEqual([]);
  });
});
