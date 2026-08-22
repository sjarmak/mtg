/**
 * What a rare is for, and the two profile fields that decide it.
 *
 * `mtg-txip`. Before this, a rare slot reached the model as the word "rare" in
 * its slot line and nothing else, while the two rules that would have said more
 * sat in the skeleton profile being read by nobody. Three things are checked
 * here and each one is a way the wiring could be fake: that the policy is
 * *derived* from the profile rather than keyed on the word "rare", that the
 * prompt says nothing extra to a tier the profile did not single out, and that
 * the wider number the bomb tier is offered is a number the DSL's validators
 * actually accept.
 */
import { describe, expect, it } from 'vitest';
import type { Ability, Card } from '@mtg/dsl';
import { exampleCard, renderOracleText, validateCard } from '@mtg/dsl';
import type { SliceRarityRules } from '@mtg/design-data';
import {
  deriveSkeletonLite,
  PLAY_BOOSTER_2024,
  rarityRank,
  RARITY_ORDER,
  SKELETON_LITE,
  SLICE_RARITIES,
} from '@mtg/design-data';
import { createProvider } from '@mtg/llm';
import type { ManaValueRange, Slot } from '@mtg/setgen';
import {
  allocateSlots,
  BOMB_COLORLESS_PERMANENT_MV,
  BOMB_STAT_BONUS_LIMIT,
  buildFillPrompt,
  COLORLESS_PERMANENT_CENSUS,
  COLORLESS_PERMANENT_MV,
  colorlessPermanentWindow,
  fillSlots,
  isSpellSlot,
  parseBrief,
  rarityPolicy,
  roleProfile,
  SPELL_CURVE,
  spellCurve,
  STAT_BONUS_LIMIT,
  TRACKED_ABILITY_KINDS,
} from '@mtg/setgen';
import { belowBombLine, scriptedTransport, slotDigest, TEST_BRIEF } from './helpers';

/** Large enough that the derivation prints a rare tier; the default 90 does not. */
const LARGE = parseBrief({ ...TEST_BRIEF, targetSize: 250 });
const largeAllocation = allocateSlots(LARGE);

const SHIPPED: SliceRarityRules = SKELETON_LITE.rarityRules;

function promptFor(slots: readonly Slot[], rules: SliceRarityRules = SHIPPED): string {
  return buildFillPrompt({
    brief: LARGE,
    slots,
    rarityRules: rules,
    archetypes: largeAllocation.archetypes,
    priorNames: [],
    sameColorCards: [],
    tierCards: [],
    corrections: new Map(),
    revisions: new Map(),
  });
}

function slotsAt(rarity: 'common' | 'uncommon' | 'rare'): Slot[] {
  return largeAllocation.slots.filter((slot) => slot.rarity === rarity).slice(0, 4);
}

describe('the profile rules the tier is read from', () => {
  it('carries both rules off the source document rather than restating them', () => {
    const source = PLAY_BOOSTER_2024.data.rarityRules;
    expect(SKELETON_LITE.rarityRules.bombsMinRarity).toBe(source.bombsMinRarity);
    expect(SKELETON_LITE.rarityRules.maxComplexityRarity).toBe(source.maxComplexityRarity);
  });

  /**
   * The rank record and the tier list are two places that both name the three
   * tiers, and only one of them is ordered on purpose. If a fourth tier is ever
   * appended to `SLICE_RARITIES`, this is what says the rank record has not been
   * told about it.
   */
  it('ranks the tiers in the order the slice lists them', () => {
    expect(Object.keys(RARITY_ORDER).sort()).toStrictEqual([...SLICE_RARITIES].sort());
    expect([...SLICE_RARITIES].sort((left, right) => rarityRank(left) - rarityRank(right))).toStrictEqual([
      ...SLICE_RARITIES,
    ]);
  });

  it('reads the bomb line off the profile instead of keying on the word rare', () => {
    const shipped = { bombsMinRarity: 'rare', maxComplexityRarity: 'rare' } as const;
    expect(rarityPolicy('uncommon', shipped).bomb).toBe(false);
    expect(rarityPolicy('rare', shipped).bomb).toBe(true);

    // A profile that opens the tier one step lower moves the line, with no edit
    // anywhere in the generator. This is the whole claim that the field is now
    // load-bearing rather than decorative.
    const permissive = { bombsMinRarity: 'uncommon', maxComplexityRarity: 'uncommon' } as const;
    expect(rarityPolicy('uncommon', permissive).bomb).toBe(true);
    expect(rarityPolicy('common', permissive).bomb).toBe(false);
  });

  /**
   * A ceiling, not a floor. The rule it comes from says the most complicated
   * cards live at one rarity and that the tier above it is deliberately more
   * straightforward, so "at or below" would be the wrong comparison in the one
   * direction that matters.
   */
  it('names exactly one tier as the home for the set complicated cards', () => {
    const rules = { bombsMinRarity: 'common', maxComplexityRarity: 'uncommon' } as const;
    expect(rarityPolicy('common', rules).complexityHome).toBe(false);
    expect(rarityPolicy('uncommon', rules).complexityHome).toBe(true);
    expect(rarityPolicy('rare', rules).complexityHome).toBe(false);
  });
});

describe('what a bomb slot is told', () => {
  it('prints a rarity section for the tier the profile singles out', () => {
    const prompt = promptFor(slotsAt('rare'));
    expect(prompt).toContain('<rarity>');
    expect(prompt).toContain('are rare slots');
    expect(prompt).toContain('allowed to be the best card in any game it appears in');
    expect(prompt).toContain('Change what it does, not what it costs');
  });

  /**
   * The gate that keeps every recorded fixture replaying. Both recorded runs in
   * this repository are below the size that prints a rare tier at all, so no
   * batch that has ever been recorded can see this section — and a common or
   * uncommon batch builds the bytes it always did.
   */
  it('says nothing extra to the tiers the profile did not single out', () => {
    expect(promptFor(slotsAt('common'))).not.toContain('<rarity>');
    expect(promptFor(slotsAt('uncommon'))).not.toContain('<rarity>');
  });

  it('follows the profile when the profile opens the tier lower', () => {
    const permissive: SliceRarityRules = { bombsMinRarity: 'uncommon', maxComplexityRarity: 'uncommon' };
    const prompt = promptFor(slotsAt('uncommon'), permissive);
    expect(prompt).toContain('<rarity>');
    expect(prompt).toContain('are uncommon slots');
    expect(promptFor(slotsAt('common'), permissive)).not.toContain('<rarity>');
  });

  it('names the slots it is talking about', () => {
    const rares = slotsAt('rare');
    const prompt = promptFor(rares);
    for (const slot of rares) expect(prompt).toContain(slot.id);
  });

  /**
   * The section names no effect and no ability kind on purpose: the vocabulary a
   * batch may spend is stated once, in the sections derived from what the slot
   * was allocated. A list here would be a second answer that goes stale the day
   * a primitive lands, and the point of writing it this way is that a widened
   * vocabulary makes these instructions reach further with no edit at all.
   */
  it('states no vocabulary of its own', () => {
    const section = /<rarity>\n([\s\S]*?)\n<\/rarity>/.exec(promptFor(slotsAt('rare')))?.[1] ?? '';
    expect(section.length).toBeGreaterThan(0);
    for (const word of ['dealDamage', 'createToken', 'destroyPermanent', 'statBonus', 'triggered']) {
      expect(section).not.toContain(word);
    }
  });
});

/**
 * The bomb tier is offered a wider printed stat bonus, and the number is the
 * validator's own.
 *
 * `@mtg/dsl` split the printed-modification ceiling off the one-shot pump
 * ceiling and widened it to two digits so a weapon could print a bonus that
 * makes any creature lethal. The generator was never told, so for as long as
 * both numbers have existed the model has been held to the smaller one at every
 * rarity. Both halves are asserted here, the way `EFFECT_RANGES` is: the prompt
 * has to name the number, and the validator has to accept a card printing it.
 */
describe('the printed stat bonus a bomb tier may state', () => {
  function creatureWithStatBonus(power: number): unknown {
    const base = exampleCard('slc-skywatch-sentinel');
    const ability: Ability = {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'statBonus', power, toughness: 0 },
    };
    const card: Card = { ...base, abilities: [ability] };
    return { ...card, oracleText: renderOracleText(card) };
  }

  /**
   * A brief that asks for a printed static ability, because `TEST_BRIEF` does
   * not and the modification bound is only ever printed for a batch that was
   * allocated one. `reserveAbilitySlots` runs per color and rarity group, so a
   * mechanic naming an ability kind reaches the rare groups as well.
   */
  const abilityBrief = parseBrief({
    ...TEST_BRIEF,
    targetSize: 250,
    mechanics: TEST_BRIEF.mechanics.map((mechanic) =>
      mechanic.name === 'Rootbound' ? { ...mechanic, abilityKinds: ['static' as const] } : mechanic,
    ),
  });
  const abilityAllocation = allocateSlots(abilityBrief);

  function abilityPromptFor(slots: readonly Slot[]): string {
    return buildFillPrompt({
      brief: abilityBrief,
      slots,
      rarityRules: SHIPPED,
      archetypes: abilityAllocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
  }

  it('offers the wider number to a bomb slot and the narrower one everywhere else', () => {
    const abilitySlots = abilityAllocation.slots.filter((slot) => slot.abilityKinds.includes('static'));
    const rare = abilitySlots.filter((slot) => slot.rarity === 'rare');
    const lower = abilitySlots.filter((slot) => slot.rarity !== 'rare');
    expect(rare.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);

    expect(abilityPromptFor(rare.slice(0, 2))).toContain(
      `between -${String(BOMB_STAT_BONUS_LIMIT)} and ${String(BOMB_STAT_BONUS_LIMIT)}`,
    );
    expect(abilityPromptFor(lower.slice(0, 2))).toContain(
      `between -${String(STAT_BONUS_LIMIT)} and ${String(STAT_BONUS_LIMIT)}`,
    );
  });

  it('is a number the validators accept, and one past it is not', () => {
    expect(validateCard(creatureWithStatBonus(BOMB_STAT_BONUS_LIMIT))).toStrictEqual([]);
    expect(validateCard(creatureWithStatBonus(STAT_BONUS_LIMIT))).toStrictEqual([]);
    expect(validateCard(creatureWithStatBonus(BOMB_STAT_BONUS_LIMIT + 1)).length).toBeGreaterThan(0);
  });
});

/**
 * The tier exists at the size the run is planned for, which is the premise
 * everything above rests on: a rarity brief for a tier the derivation never
 * prints would be an instruction nobody is ever shown.
 */
describe('the tier the run will actually have', () => {
  it('prints rare slots at 250 cards and none at the default size', () => {
    const rares = largeAllocation.slots.filter((slot) => slot.rarity === 'rare');
    expect(rares.length).toBeGreaterThan(0);
    expect(allocateSlots(parseBrief(TEST_BRIEF)).slots.some((slot) => slot.rarity === 'rare')).toBe(false);
  });
});

describe('every permanent at the bomb tier is asked for an ability', () => {
  /**
   * A rare with no printed rules text is a keyword body, and a Limited bomb is a
   * card a deck is built around. `reserveAbilitySlots` used to hand each
   * mechanic one slot per group, which is a New World Order rule — an ability at
   * common spends a red flag — and that budget is counted over commons and
   * nothing else (`validate/nwo.ts`). Above the profile's `bombsMinRarity` there
   * is no budget to protect, so the cap is lifted there and only there.
   *
   * Measured on a brief whose mechanics name an ability kind, because a brief
   * that names none has nothing to reserve and would pass this vacuously.
   */
  const withAbilities = parseBrief({
    ...TEST_BRIEF,
    targetSize: 250,
    mechanics: (TEST_BRIEF.mechanics ?? []).map((mechanic) => ({
      ...mechanic,
      abilityKinds: ['triggered' as const],
    })),
  });
  const allocated = allocateSlots(withAbilities);

  /**
   * Colored permanents only, and that is the rule rather than a convenience.
   * `appliesToPool` reaches the colorless pool only for a mechanic that names no
   * colors, so a brief whose mechanics all name colors has nothing to give a
   * colorless group and its slots stay vanilla. This brief's three mechanics
   * cover the five colors between them and none of them reaches colorless.
   */
  function permanentsAt(slots: readonly Slot[], rarity: string): Slot[] {
    return slots.filter(
      (slot) =>
        slot.rarity === rarity &&
        slot.color !== null &&
        slot.cardKind !== 'instant' &&
        slot.cardKind !== 'sorcery',
    );
  }

  it('leaves no permanent rare slot without one', () => {
    const permanents = permanentsAt(allocated.slots, 'rare');
    expect(permanents.length).toBeGreaterThan(0);
    expect(permanents.filter((slot) => slot.abilityKinds.length === 0).map((slot) => slot.id)).toStrictEqual(
      [],
    );
  });

  it('still gives a common group one slot per mechanic, because that budget is real', () => {
    // The same allocation, one tier down: the cap holds where the red flags are
    // counted, so no common group carries more *tracked* ability slots than the
    // brief has mechanics. `fillTextlessPermanents` (`mtg-bc2.26.5.1`) can still
    // hand a leftover common a `static` ability - that costs the New World
    // Order budget nothing (`TRACKED_ABILITY_KINDS`, `nwo.ts`) - so it is
    // excluded here, the same way the flagship brief's own test excludes it
    // from `abilityCommons`.
    const perGroup = new Map<string, number>();
    for (const slot of allocated.slots) {
      if (slot.rarity !== 'common') continue;
      if (!slot.abilityKinds.some((kind) => TRACKED_ABILITY_KINDS.includes(kind))) continue;
      const key = slot.color ?? 'colorless';
      perGroup.set(key, (perGroup.get(key) ?? 0) + 1);
    }
    expect([...perGroup.values()].filter((count) => count > withAbilities.mechanics.length)).toStrictEqual(
      [],
    );
  });

  it('reads the tier off the profile rather than the word rare', () => {
    // A profile whose bombs start at uncommon fills its uncommon groups the same
    // way. Nothing here tests for a rarity by name.
    const rules: SliceRarityRules = { ...SHIPPED, bombsMinRarity: 'uncommon' };
    const shifted = allocateSlots(withAbilities, { ...allocated.profile, rarityRules: rules });
    expect(
      permanentsAt(shifted.slots, 'uncommon').filter((slot) => slot.abilityKinds.length === 0),
    ).toStrictEqual([]);
  });
});

/**
 * The ability a bomb-tier permanent gets is an ability, not a fifth copy of the
 * set's first mechanic.
 *
 * `mtg-b862`. Filling every permanent slot was right; cycling the applicable
 * mechanics to do it was not, and the census that settled it says why. A
 * mechanic that names colors reaches only those pools; one that names none
 * reaches all six. So the cycle does not spread, it repeats whichever mechanic
 * is colorless, and at 249 cards the flagship's first mechanic landed on eleven
 * of its fourteen rare permanents.
 *
 * The naming round is therefore capped exactly as it is at every other tier, and
 * the permanents left over are allocated the ability *kinds* the pool's
 * mechanics use with no mechanic attached — the shape `assignSignposts` already
 * uses, and for the same reason: a slot told to print an ability and not told
 * which mechanic it is has been left room to be its own card.
 *
 * Measured on a brief whose mechanics name ability kinds and no keywords, so
 * that a slot's `mechanics` list is this pass's doing and nothing else's;
 * `mechanicsForKeywords` tags a slot from its keywords and would otherwise be
 * counted here as a repetition this pass never made.
 */
describe('a bomb-tier permanent past the naming round', () => {
  const everywhere = parseBrief({
    ...TEST_BRIEF,
    targetSize: 250,
    mechanics: [
      // One mechanic naming no colors, which is the shape that produced the
      // repetition: it is applicable in all five colors and in the colorless
      // pool, so it was the one the old cycle kept handing out.
      {
        name: 'Tidewrack',
        description: 'A permanent leaves something behind when it goes.',
        abilityKinds: ['triggered' as const],
        colors: [],
      },
      {
        name: 'Glasscut',
        description: 'Efficient trades, paid for by an activation.',
        abilityKinds: ['activated' as const],
        colors: ['B' as const, 'R' as const],
      },
    ],
  });
  const spread = allocateSlots(everywhere);

  function permanents(rarity: string): Slot[] {
    return spread.slots.filter(
      (slot) => slot.rarity === rarity && slot.cardKind !== 'instant' && slot.cardKind !== 'sorcery',
    );
  }

  it('still leaves no permanent without printed rules text', () => {
    const rares = permanents('rare');
    expect(rares.length).toBeGreaterThan(0);
    expect(rares.filter((slot) => slot.abilityKinds.length === 0).map((slot) => slot.id)).toStrictEqual([]);
  });

  it('names no mechanic twice in one group, so the tier is not one card many times', () => {
    const perGroup = new Map<string, number>();
    for (const slot of permanents('rare')) {
      for (const mechanic of slot.mechanics) {
        const key = `${slot.color ?? 'colorless'}:${mechanic}`;
        perGroup.set(key, (perGroup.get(key) ?? 0) + 1);
      }
    }
    expect([...perGroup].filter(([, count]) => count > 1)).toStrictEqual([]);
    // And the colorless pool, where every permanent used to carry the one
    // mechanic that reaches it, now carries it once.
    const colorless = permanents('rare').filter((slot) => slot.color === null);
    expect(colorless.length).toBeGreaterThan(1);
    expect(colorless.filter((slot) => slot.mechanics.includes('Tidewrack'))).toHaveLength(1);
  });

  it('gives the rest the ability kinds the brief uses, and no mechanic and no condition', () => {
    const unnamed = permanents('rare').filter((slot) => slot.mechanics.length === 0);
    expect(unnamed.length).toBeGreaterThan(0);
    // The set's own vocabulary rather than the DSL's whole list: a rare printing
    // a kind no mechanic in this brief uses would be a card from another set.
    const asked = new Set(everywhere.mechanics.flatMap((mechanic) => mechanic.abilityKinds));
    expect(unnamed.every((slot) => slot.abilityKinds.every((kind) => asked.has(kind)))).toBe(true);
    // A trigger condition rides with the mechanic that asked for it, and these
    // slots were told no mechanic.
    expect(unnamed.filter((slot) => slot.triggerConditions.length > 0)).toStrictEqual([]);
  });

  it('leaves every tier below the bomb line with permanents that print nothing', () => {
    // The cap is a New World Order rule and NWO counts commons, so lifting it
    // above the line must not lift it below: a common group still holds vanilla
    // bodies.
    expect(permanents('common').filter((slot) => slot.abilityKinds.length === 0).length).toBeGreaterThan(0);
  });
});

/**
 * What a bomb-tier spell costs, which is the other half of the same rule.
 *
 * `mtg-iudb`. `topOfCurve` fixed the creature curve at this tier and left the
 * spell curve alone, so a rare group holding one spell slot took
 * `apportion(1, [1, 3, 3, 2])` — the mode of the curve, mana value 2. That is
 * the right answer for a common pool and a two-mana rare everywhere else, and
 * the two curves are one card apart: an inert spell slot is converted into a
 * body at the mana value the spell would have cost.
 *
 * Three passes read the curve — the allocator, the archetype reservation and
 * the required-card settlement — and they have to agree, or a body bought out
 * of a bomb-tier spell slot inherits a window the allocator would never have
 * printed. The four cases below are the walk itself, the groups it must not
 * touch, the allocation it produces, and that the tier is the profile's word.
 */
describe('a bomb-tier spell costs from the expensive end of its curve', () => {
  const top = SPELL_CURVE[SPELL_CURVE.length - 1];

  it('seats a group too small for the curve at the dear end rather than the mode', () => {
    expect(spellCurve(1, false)).toStrictEqual([{ min: 2, max: 2 }]);
    expect(spellCurve(1, true)).toStrictEqual([top]);
    expect(spellCurve(2, true)).toStrictEqual([top, top]);
  });

  /**
   * The acceptance criterion, as a property: a group with a slot per bucket can
   * seat its own curve, so there is nothing to drop and nothing to decide.
   */
  it('leaves any group large enough to seat its own curve exactly where it was', () => {
    for (let spells = SPELL_CURVE.length; spells <= 20; spells += 1) {
      expect(spellCurve(spells, true), `${spells} spells`).toStrictEqual(spellCurve(spells, false));
    }
  });

  it('gives every rare spell whose role fixes no window the dear end of the curve', () => {
    const rareSpells = largeAllocation.slots.filter(
      (slot) => slot.rarity === 'rare' && slot.color !== null && isSpellSlot(slot),
    );
    const unstated = rareSpells.filter((slot) => roleProfile(slot.role).manaValue === undefined);
    expect(unstated.length).toBeGreaterThan(0);
    for (const slot of unstated) {
      expect(slot.manaValueMin, slot.id).toBeGreaterThanOrEqual(top?.min ?? 0);
    }
    // A role that fixes its own window keeps it: a spell that is dear is not
    // automatically a rare, and the table is the authority on what a role costs.
    const stated = rareSpells.filter((slot) => roleProfile(slot.role).manaValue !== undefined);
    for (const slot of stated) {
      const fixed = roleProfile(slot.role).manaValue;
      expect(slot.manaValueMin, slot.id).toBe(fixed?.min);
    }
  });

  /**
   * Derived from the profile rather than keyed on the word "rare": a profile
   * that opens the tier lower moves the uncommon windows too, and the common
   * groups — which hold nine spells and up, a slot per bucket — stay put under
   * either rule.
   */
  it('reads the bomb line off the profile', () => {
    const profile = deriveSkeletonLite({ targetSize: 250 });
    const lower = {
      ...profile,
      rarityRules: { ...profile.rarityRules, bombsMinRarity: 'uncommon' as const },
    };
    const moved = allocateSlots(LARGE, lower).slots;
    const windows = (slots: readonly Slot[], rarity: 'common' | 'uncommon'): string[] =>
      slots
        .filter((slot) => slot.rarity === rarity && isSpellSlot(slot))
        .map((slot) => `${slot.id} ${slot.manaValueMin}-${slot.manaValueMax}`);
    expect(windows(moved, 'common')).toStrictEqual(windows(largeAllocation.slots, 'common'));
    expect(windows(moved, 'uncommon')).not.toStrictEqual(windows(largeAllocation.slots, 'uncommon'));
  });
});

/**
 * What a bomb-tier colorless permanent costs, which is the fourth curve of the
 * same shape and the last one that was still tier-blind.
 *
 * `mtg-tqkc`. `topOfCurve` fixed the creature curve at this tier and `mtg-iudb`
 * fixed the spell curve; the colorless pool's noncreature permanents kept
 * rotating one three-window list at every rarity, starting at the cheap end. A
 * rare group holding four of them came out at mana value 2, 3, 4, 2 — half the
 * tier at two mana, and the ceiling of the whole rotation equal to the common
 * pool's ceiling.
 *
 * The other two fixes reversed a published curve, and this one could not: a
 * rotation visits every entry, so reading it backwards still prints the cheap
 * window. So the tier states its own list, and the four cases below are the
 * derivation behind those numbers, the rotation itself, the allocation it
 * produces, and the sentence the whole change is measured against — that
 * nothing below the bomb line moved.
 */
describe('a bomb-tier colorless permanent costs from the window list its tier states', () => {
  const bombWindows = (slots: readonly Slot[]): Slot[] =>
    slots.filter((slot) => slot.rarity === 'rare' && slot.color === null && slot.cardKind === 'artifact');

  it('states the tier windows as the dear half of what real sets print there', () => {
    // The derivation, run again over the recorded census rather than restated:
    // the three most-printed mana values at or above the population's median.
    // Editing the constant without editing the census fails here, which is what
    // makes the docblock's argument a check rather than a claim.
    const entries = Object.entries(COLORLESS_PERMANENT_CENSUS.cards)
      .map(([manaValue, cards]) => ({ manaValue: Number(manaValue), cards }))
      .sort((a, b) => a.manaValue - b.manaValue);
    const total = entries.reduce((sum, entry) => sum + entry.cards, 0);
    // The population size, written here as well as in the census, so a
    // histogram edited one bucket at a time cannot slip through.
    expect(total).toBe(346);

    let seen = 0;
    let median = 0;
    for (const entry of entries) {
      seen += entry.cards;
      if (seen * 2 >= total) {
        median = entry.manaValue;
        break;
      }
    }
    expect(median).toBe(3);

    const dear = entries.filter((entry) => entry.manaValue >= median);
    const mostPrinted = [...dear]
      .sort((a, b) => b.cards - a.cards || a.manaValue - b.manaValue)
      .slice(0, BOMB_COLORLESS_PERMANENT_MV.length)
      .sort((a, b) => a.manaValue - b.manaValue);
    expect(BOMB_COLORLESS_PERMANENT_MV).toStrictEqual(
      mostPrinted.map((entry) => ({ min: entry.manaValue, max: entry.manaValue })),
    );
  });

  /**
   * The defect stated as a property rather than as four mana values: the tier a
   * set may print a game-winning card at could not reach past the cheapest
   * pool's ceiling, at either end of its list.
   */
  it('reaches dearer at both ends than the tiers below it can', () => {
    const floor = (list: readonly ManaValueRange[]): number => Math.min(...list.map((window) => window.min));
    const ceiling = (list: readonly ManaValueRange[]): number =>
      Math.max(...list.map((window) => window.max));
    expect(floor(BOMB_COLORLESS_PERMANENT_MV)).toBeGreaterThan(floor(COLORLESS_PERMANENT_MV));
    expect(ceiling(BOMB_COLORLESS_PERMANENT_MV)).toBeGreaterThan(ceiling(COLORLESS_PERMANENT_MV));
  });

  it('rotates each tier over its own list and keeps rotating past the end of it', () => {
    for (const [ordinal, window] of BOMB_COLORLESS_PERMANENT_MV.entries()) {
      expect(colorlessPermanentWindow(ordinal, true), `bomb ${ordinal}`).toStrictEqual(window);
      const wrapped = ordinal + BOMB_COLORLESS_PERMANENT_MV.length;
      expect(colorlessPermanentWindow(wrapped, true), `bomb ${wrapped}`).toStrictEqual(window);
    }
    for (const [ordinal, window] of COLORLESS_PERMANENT_MV.entries()) {
      expect(colorlessPermanentWindow(ordinal, false), `below ${ordinal}`).toStrictEqual(window);
    }
  });

  it('seats the rare pool gear on that list rather than on the common pool rotation', () => {
    const gear = bombWindows(largeAllocation.slots);
    expect(gear.length).toBeGreaterThan(0);
    for (const slot of gear) {
      expect(
        BOMB_COLORLESS_PERMANENT_MV.map((window) => `${window.min}-${window.max}`),
        slot.id,
      ).toContain(`${slot.manaValueMin}-${slot.manaValueMax}`);
    }
  });

  /**
   * The acceptance criterion, pinned rather than sampled. The digest is the one
   * this allocation produced before the bomb list existed, so it says the change
   * reached the bomb tier and stopped there — every field of every slot at every
   * tier below the line is the byte it was.
   */
  it('leaves every tier below the bomb line byte-identical', () => {
    expect(slotDigest(belowBombLine(largeAllocation.slots, SHIPPED))).toBe(
      'c50dc7cea38116c620eab439ebec0cd5b875e9b7f41fbc1ef272a77b76bc6ba5',
    );
  });
});

/**
 * The anti-repeat rule reaches across the tier, because the batch it was
 * written in cannot.
 *
 * `mtg-afw9`. `batchSlots` keys on `(rarity, color)`, so a bomb batch is one
 * color's rares and the `<rarity>` line telling it not to build several cards
 * on one idea could only ever mean "not twice inside this batch". The other four
 * colors were invisible to it, and `checkDesignRepeats` then failed the set for
 * a collision the model was never shown. Batches are sequential and accumulate,
 * so the tier so far is already in hand by the time the second color is asked
 * for; this is that list reaching the prompt.
 *
 * The gate is the tier and not the list, which is what keeps the recorded
 * fixtures replaying: a batch below `bombsMinRarity` builds the bytes it always
 * did no matter what has been printed before it, and so does the first bomb
 * batch of a run, which has no tier behind it.
 */
describe('what a bomb batch is told about the rest of its tier', () => {
  async function promptsFromAFullRound(): Promise<readonly string[]> {
    const transport = scriptedTransport({ slots: largeAllocation.slots });
    await fillSlots({
      provider: createProvider(transport),
      brief: LARGE,
      round: 0,
      slots: largeAllocation.slots,
      allSlots: largeAllocation.slots,
      rarityRules: SHIPPED,
      archetypes: largeAllocation.archetypes,
      printed: new Map(),
      corrections: new Map(),
      revisions: new Map(),
    });
    return transport.prompts;
  }

  /** The prompt whose batch opens on this slot id, by the slot line it prints. */
  function promptOpeningOn(prompts: readonly string[], slotId: string): string {
    const found = prompts.find((prompt) => prompt.includes(`\n${slotId}: `));
    if (found === undefined) throw new Error(`no batch was asked for ${slotId}`);
    return found;
  }

  it('shows a later color the rares the earlier colors printed', async () => {
    const prompts = await promptsFromAFullRound();
    const blue = promptOpeningOn(prompts, 'RU01');

    const section = /<tier_so_far>\n([\s\S]*?)\n<\/tier_so_far>/.exec(blue)?.[1] ?? '';
    // Asserted inside the section rather than anywhere in the prompt: every
    // printed name is already listed under `<already_printed>`, so a whole-
    // prompt match would pass with no section at all. `synthesizeCard` names
    // its cards after the slot, which is what makes the white rares findable.
    expect(section).toContain('Glass Warden RW01');
    expect(section).toContain('the whole rare tier, not only this batch');
  });

  it('says nothing to the first bomb batch, which has no tier behind it', async () => {
    const prompts = await promptsFromAFullRound();
    expect(promptOpeningOn(prompts, 'RW01')).not.toContain('<tier_so_far>');
  });

  it('says nothing to a batch below the bomb tier, however much came before it', async () => {
    const prompts = await promptsFromAFullRound();
    for (const rarity of ['common', 'uncommon'] as const) {
      const slot = largeAllocation.slots.find((item) => item.rarity === rarity && item.color === 'G');
      expect(slot, `no ${rarity} green slot`).toBeDefined();
      if (slot === undefined) continue;
      expect(promptOpeningOn(prompts, slot.id)).not.toContain('<tier_so_far>');
    }
  });

  it('leaves the batch alone when the tier so far is empty', () => {
    const rare = slotsAt('rare');
    const withNothing = promptFor(rare);
    const withTier = buildFillPrompt({
      brief: LARGE,
      slots: rare,
      rarityRules: SHIPPED,
      archetypes: largeAllocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [exampleCard('slc-skywatch-sentinel')],
      corrections: new Map(),
      revisions: new Map(),
    });
    expect(withNothing).not.toContain('<tier_so_far>');
    expect(withTier).toContain('<tier_so_far>');
    expect(withTier.replace(/<tier_so_far>[\s\S]*<\/tier_so_far>\n\n/, '')).toBe(withNothing);
  });
});
