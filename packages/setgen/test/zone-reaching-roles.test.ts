/**
 * The slots a brief commissions when it asks for exile, scry or reanimation.
 *
 * `mtg-q5yg`. Three primitives left `UNPRICED_EFFECT_KINDS` and three roles were
 * added to `ROLE_PROFILES` to reach them. None of the three appears in the
 * published skeleton, so — exactly as with the enchantment and walker roles a
 * lane earlier — the only way to print one is a brief that states it in
 * `spellRoles`, and this file is the whole of that front door: what the roles
 * say, which pools may state them, what the allocator seats, which answer schema
 * that batch is then shown, and which vocabulary lines it is shown beside it.
 *
 * The schema half is checked here rather than left to the union's own suite for
 * the reason `spell-permanent-slots.test.ts` gives: a fixture key hashes
 * (system, prompt, schema), so a batch holding none of these slots has to be
 * shown the bytes it was always shown. Six new tiers that widened for every
 * batch, or three vocabulary lines that leaked into every prompt, would strand
 * all 172 recorded calls behind a paid re-record, and the first evidence would
 * be the invoice.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_EFFECT_KINDS, ZONE_REACHING_MODEL_EFFECT_KINDS } from '@mtg/dsl';
import {
  allocateSlots,
  ARTIFACT_ROLES,
  batchWantsZoneReach,
  buildFillPrompt,
  FillBatchSchema,
  FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema,
  FillBatchWithAbilitiesAndZoneReachSchema,
  FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema,
  FillBatchWithMechanicsAndZoneReachSchema,
  FillBatchWithSpellPermanentsAndZoneReachSchema,
  FillBatchWithZoneReachSchema,
  fillSchemaFor,
  isZoneReachingRole,
  parseBrief,
  roleProfile,
} from '@mtg/setgen';
import type { SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

/** Large enough that the derivation prints a rare tier; the default 20 does not. */
const LARGE = 250;

const ZONE_REACHING_ROLES = ['exileRemoval', 'scryCantrip', 'massReanimation'] as const;

function briefStating(rarity: string, pool: string, role: string): SetBrief {
  return parseBrief({
    ...TEST_BRIEF,
    targetSize: LARGE,
    spellRoles: [{ rarity, pool, roles: [role], why: `the test asks ${pool} for a ${role}.` }],
  } as SetBriefInput);
}

function slotsOfRole(brief: SetBrief, role: string): Slot[] {
  return allocateSlots(brief).slots.filter((slot) => slot.role === role);
}

function oneSlotOfRole(brief: SetBrief, role: string): Slot {
  const [slot] = slotsOfRole(brief, role);
  if (slot === undefined) throw new Error(`no slot was allocated for role "${role}"`);
  return slot;
}

describe('what the three roles say', () => {
  it('names each of them zone-reaching and every other role not', () => {
    for (const role of ZONE_REACHING_ROLES) expect(isZoneReachingRole(role), role).toBe(true);
    // `removalExile` is the interesting negative: its name says exile and its
    // substitution note says the DSL has none, and it still prints the tempo
    // effect it always printed. The new roles are what reach the primitive.
    for (const role of ['removalExile', 'burnSmall', 'anthem', 'planeswalker', ...ARTIFACT_ROLES]) {
      expect(isZoneReachingRole(role), role).toBe(false);
    }
  });

  it('derives that from the vocabulary split rather than from a list', () => {
    // The predicate subtracts what every batch is shown from what the wider
    // union carries, so the three roles are zone-reaching because their
    // primitives are, not because they were named somewhere.
    const shown: readonly string[] = MODEL_EFFECT_KINDS;
    const promoted: readonly string[] = ZONE_REACHING_MODEL_EFFECT_KINDS.filter(
      (kind) => !shown.includes(kind),
    );
    expect([...promoted].sort()).toStrictEqual(['exileTarget', 'returnFromGraveyard', 'scry']);
    for (const role of ZONE_REACHING_ROLES) {
      const wanted: readonly string[] = roleProfile(role).effectKinds;
      expect(
        wanted.some((kind) => promoted.includes(kind)),
        role,
      ).toBe(true);
    }
  });

  it('prices the exile up in mana and in speed, because exile is the stronger word', () => {
    expect(roleProfile('exileRemoval').effectKinds).toStrictEqual(['exileTarget']);
    expect(roleProfile('exileRemoval').manaValue).toStrictEqual({ min: 3, max: 5 });
  });

  it('pairs the scry with a draw, because a card whose whole text is scry 2 is unplayable', () => {
    // Both halves matter downstream: `@mtg/deckbuild` prices `scry` at zero, so
    // a scry-only common would be cut from every deck built out of the set.
    expect([...roleProfile('scryCantrip').effectKinds].sort()).toStrictEqual(['drawCards', 'scry']);
    expect(roleProfile('scryCantrip').manaValue).toStrictEqual({ min: 1, max: 2 });
  });

  it('puts the reanimation at the top end, where the primitive has anything to return', () => {
    expect(roleProfile('massReanimation').effectKinds).toStrictEqual(['returnFromGraveyard']);
    expect(roleProfile('massReanimation').manaValue).toStrictEqual({ min: 5, max: 6 });
  });
});

describe('where a brief may state one', () => {
  it('takes each of the three in a color the pie licenses', () => {
    expect(() => briefStating('common', 'W', 'exileRemoval')).not.toThrow();
    expect(() => briefStating('common', 'U', 'scryCantrip')).not.toThrow();
    expect(() => briefStating('rare', 'B', 'massReanimation')).not.toThrow();
  });

  it('refuses all three in the colorless pool, where the pie row would have no color to read', () => {
    for (const role of ZONE_REACHING_ROLES) {
      expect(() => briefStating('common', 'colorless', role), role).toThrow(
        /prints an effect the color pie assigns to a color/,
      );
      expect(() => briefStating('common', 'colorless', role), role).toThrow(/state it for a color/);
    }
  });

  it('keeps that refusal at the brief rather than at the allocator, so it names the role', () => {
    expect(() => briefStating('rare', 'colorless', 'massReanimation')).toThrow(
      /the massReanimation role prints an effect/,
    );
  });
});

describe('the color pie answering a stated role', () => {
  it('seats the exile in white, the one color the row makes primary', () => {
    const slots = slotsOfRole(briefStating('common', 'W', 'exileRemoval'), 'exileRemoval');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.cardKind, slot.id).toBe('sorcery');
      expect(slot.color, slot.id).toBe('W');
      expect(slot.effectKinds, slot.id).toStrictEqual(['exileTarget']);
      expect(slot.manaValueMin, slot.id).toBeGreaterThanOrEqual(3);
      expect(slot.manaValueMax, slot.id).toBeLessThanOrEqual(5);
    }
  });

  it('throws on the exile anywhere else rather than printing an off-pie card', () => {
    // The row is INFERRED white-primary off the Banisher Priest entry and gives
    // no other color even a secondary, so four of the five colors fail here.
    for (const pool of ['U', 'B', 'R', 'G']) {
      expect(() => allocateSlots(briefStating('common', pool, 'exileRemoval')), pool).toThrow(
        /role "exileRemoval" has no on-pie effect primitive in /,
      );
    }
  });

  it('seats the reanimation in four colors and throws in blue', () => {
    for (const pool of ['W', 'B', 'R', 'G']) {
      const slot = oneSlotOfRole(briefStating('rare', pool, 'massReanimation'), 'massReanimation');
      expect(slot.cardKind, pool).toBe('sorcery');
      expect(slot.effectKinds, pool).toStrictEqual(['returnFromGraveyard']);
      expect(slot.manaValueMin, pool).toBe(5);
      expect(slot.manaValueMax, pool).toBe(6);
    }
    expect(() => allocateSlots(briefStating('rare', 'U', 'massReanimation'))).toThrow(
      /role "massReanimation" has no on-pie effect primitive in U: \[returnFromGraveyard\] are all off-pie there/,
    );
  });

  it('never throws on the scry, because its row gives every color a level', () => {
    for (const pool of ['W', 'U', 'B', 'R', 'G']) {
      expect(() => allocateSlots(briefStating('common', pool, 'scryCantrip')), pool).not.toThrow();
    }
  });
});

describe('the archetype budget reading a cantrip', () => {
  // Both of the cantrip's primitives are in `BATTLEFIELD_INERT_EFFECTS`, so the
  // archetype pass converts the slots past a color's blank budget into bodies.
  // That is the guard doing its job on a card that genuinely does not touch the
  // board, and it means a brief that states the role fifteen times does not get
  // fifteen cantrips. What it must never do is happen quietly.
  it('converts the ones past the budget and names the role in a note for each', () => {
    const brief = briefStating('common', 'U', 'scryCantrip');
    const allocation = allocateSlots(brief);
    const kept = allocation.slots.filter((slot) => slot.role === 'scryCantrip');
    const converted = allocation.notes.filter(
      (note) => note.includes('"scryCantrip" slot') && note.includes('became a creature'),
    );
    expect(converted.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(1);
  });

  it('leaves the exile and the reanimation alone, because both touch the battlefield', () => {
    const exile = allocateSlots(briefStating('common', 'W', 'exileRemoval'));
    expect(exile.slots.filter((slot) => slot.role === 'exileRemoval').length).toBeGreaterThan(1);
    expect(exile.notes.filter((note) => note.includes('"exileRemoval" slot'))).toStrictEqual([]);
    const reanimation = allocateSlots(briefStating('rare', 'B', 'massReanimation'));
    expect(reanimation.notes.filter((note) => note.includes('"massReanimation" slot'))).toStrictEqual([]);
  });
});

describe('the answer schema the batch is shown', () => {
  const exileSlot = oneSlotOfRole(briefStating('common', 'W', 'exileRemoval'), 'exileRemoval');
  const auraSlot = oneSlotOfRole(
    parseBrief({
      ...TEST_BRIEF,
      targetSize: LARGE,
      spellRoles: [
        { rarity: 'common', pool: 'W', roles: ['exileRemoval'], why: 'the test asks W for an exile.' },
        { rarity: 'common', pool: 'G', roles: ['auraPacify'], why: 'the test asks G for an Aura.' },
      ],
    } as SetBriefInput),
    'auraPacify',
  );

  function withAbility(slot: Slot): Slot {
    return { ...slot, id: `${slot.id}A`, abilityKinds: ['activated'] };
  }

  function withMechanic(slot: Slot): Slot {
    return {
      ...slot,
      id: `${slot.id}M`,
      requiredCard: { name: 'Fused Husk', equipment: false, legendary: false, partCounter: 'horn' },
    };
  }

  it('shows a zone-reaching batch the narrowest of the six new tiers', () => {
    expect(batchWantsZoneReach([exileSlot])).toBe(true);
    expect(fillSchemaFor([exileSlot])).toBe(FillBatchWithZoneReachSchema);
  });

  it('crosses it with abilities, mechanics and permanents, one tier per combination', () => {
    expect(fillSchemaFor([exileSlot, withAbility(exileSlot)])).toBe(FillBatchWithAbilitiesAndZoneReachSchema);
    expect(fillSchemaFor([exileSlot, withMechanic(exileSlot)])).toBe(
      FillBatchWithMechanicsAndZoneReachSchema,
    );
    expect(fillSchemaFor([exileSlot, auraSlot])).toBe(FillBatchWithSpellPermanentsAndZoneReachSchema);
    expect(fillSchemaFor([exileSlot, auraSlot, withAbility(exileSlot)])).toBe(
      FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema,
    );
    expect(fillSchemaFor([exileSlot, auraSlot, withMechanic(exileSlot)])).toBe(
      FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema,
    );
  });

  it('refuses a batch holding both a weapon and a zone-reaching slot rather than picking one', () => {
    const weapon: Slot = {
      ...exileSlot,
      id: 'CA01',
      color: null,
      cardKind: 'artifact',
      role: 'gearCommon',
      effectKinds: [],
      requiredCard: { name: 'Moonblade', equipment: true, legendary: false },
    };
    expect(() => fillSchemaFor([weapon, exileSlot])).toThrow(
      /holds both a weapon and a slot allowed exileTarget, scry or returnFromGraveyard/,
    );
  });

  it('leaves a batch holding none of them exactly where it was, which is the point of the split', () => {
    const plain = allocateSlots(briefStating('common', 'W', 'exileRemoval')).slots.filter(
      (slot) =>
        slot.cardKind === 'creature' && slot.abilityKinds.length === 0 && slot.requiredCard === undefined,
    );
    expect(plain.length).toBeGreaterThan(0);
    expect(batchWantsZoneReach(plain)).toBe(false);
    expect(fillSchemaFor(plain)).toBe(FillBatchSchema);
  });
});

describe('the vocabulary lines that explain them', () => {
  const brief = briefStating('common', 'W', 'exileRemoval');
  const allocation = allocateSlots(brief);

  function promptFor(slots: readonly Slot[]): string {
    return buildFillPrompt({
      brief,
      slots,
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
  }

  it('teaches the exile its one target and no parameters', () => {
    const prompt = promptFor([oneSlotOfRole(brief, 'exileRemoval')]);
    expect(prompt).toContain('- exileTarget: no parameters; target.kind: targetCreature');
    expect(prompt).not.toContain('scry:');
    expect(prompt).not.toContain('returnFromGraveyard:');
  });

  it('teaches the scry its count and that it takes no target', () => {
    // Green rather than blue, and the choice is the blank budget rather than
    // the pie: blue spends its allowance on the roles its own list already
    // holds, so every stated cantrip there is converted and there is no slot
    // left to build a prompt from. Green keeps one.
    const scryBrief = briefStating('common', 'G', 'scryCantrip');
    const scryAllocation = allocateSlots(scryBrief);
    const slot = oneSlotOfRole(scryBrief, 'scryCantrip');
    const prompt = buildFillPrompt({
      brief: scryBrief,
      slots: [slot],
      rarityRules: scryAllocation.profile.rarityRules,
      archetypes: scryAllocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
    expect(prompt).toContain('- scry: count 1-4; takes no target field');
    expect(prompt).toContain('- drawCards: count 1-6;');
  });

  it('tells the reanimation to print the one scope it is allowed and what it returns', () => {
    const reanimationBrief = briefStating('rare', 'B', 'massReanimation');
    const reanimationAllocation = allocateSlots(reanimationBrief);
    const slot = oneSlotOfRole(reanimationBrief, 'massReanimation');
    const prompt = buildFillPrompt({
      brief: reanimationBrief,
      slots: [slot],
      rarityRules: reanimationAllocation.profile.rarityRules,
      archetypes: reanimationAllocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
    expect(prompt).toContain('print scope exactly "creatureCardsInPlayerGraveyard"');
    expect(prompt).toContain('returns every creature card in that graveyard rather than one');
    expect(prompt).toContain('target.kind: targetPlayer');
  });

  it('shows none of the three lines to a batch that was allocated none of them', () => {
    const plain = allocation.slots.filter(
      (slot) => slot.cardKind === 'creature' && slot.abilityKinds.length === 0,
    );
    expect(plain.length).toBeGreaterThan(0);
    const prompt = promptFor(plain);
    expect(prompt).not.toContain('exileTarget');
    expect(prompt).not.toContain('- scry:');
    expect(prompt).not.toContain('returnFromGraveyard');
  });
});
