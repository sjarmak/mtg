import { describe, expect, it } from 'vitest';
import { COLORS, KEYWORDS } from '@mtg/dsl';
import {
  deriveSkeletonLite,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  SKELETON_LITE,
  SLICE_RARITIES,
} from '@mtg/design-data';
import {
  allocateSlots,
  allowedEffectKinds,
  parseBrief,
  ROLE_PROFILES,
  roleProfile,
  UnknownRoleError,
} from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

const brief = parseBrief(TEST_BRIEF);

describe('allocateSlots determinism', () => {
  it('produces byte-identical slots for the same seed', () => {
    const first = allocateSlots(brief);
    const second = allocateSlots(brief);
    expect(JSON.stringify(second.slots)).toBe(JSON.stringify(first.slots));
    expect(second.notes).toStrictEqual(first.notes);
  });

  it('produces a different keyword layout for a different seed', () => {
    const full = parseBrief({ ...TEST_BRIEF, targetSize: 90 });
    const a = allocateSlots(full);
    const b = allocateSlots({ ...full, seed: 'a-different-seed' });
    const keywordsOf = (slots: (typeof a)['slots']): string =>
      slots.map((slot) => `${slot.id}:${slot.keywords.join('|')}`).join(',');
    expect(keywordsOf(b.slots)).not.toBe(keywordsOf(a.slots));
    // The layout moves; the budget does not.
    const count = (slots: (typeof a)['slots']): number =>
      slots.reduce((sum, slot) => sum + slot.keywords.length, 0);
    expect(count(b.slots)).toBe(count(a.slots));
  });

  /**
   * At the floor the seed stops mattering, and that is a fact worth failing on.
   *
   * `MIN_SLICE_TARGET_SIZE` gives each color two commons and one uncommon, which
   * is the exact number of cards the allocator has placements for: every choice
   * list is spent in full, so its rng never chooses between two outcomes and two
   * seeds build the same twenty slots. Every larger size keeps the freedom the
   * test above measures.
   *
   * It is asserted here because a replay is what notices when it changes. A
   * fixture is keyed by the hash of its request, so a test that reaches for an
   * unrecorded prompt by moving the seed gets the recorded prompt back and
   * passes without testing anything (`pipeline.test.ts`). Naming the floor makes
   * that a failure at the allocator rather than a silent pass downstream.
   */
  it('runs out of choices at the smallest set it will build, and only there', () => {
    const layoutAt = (targetSize: number, seed: string): string =>
      JSON.stringify(allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize, seed })).slots);
    expect(layoutAt(MIN_SLICE_TARGET_SIZE, 'fixture-seed-1')).toBe(
      layoutAt(MIN_SLICE_TARGET_SIZE, 'a-different-seed'),
    );
    for (const targetSize of [MIN_SLICE_TARGET_SIZE + 1, 25, 30, 50, 90]) {
      expect(layoutAt(targetSize, 'fixture-seed-1'), `size ${targetSize} ignores its seed`).not.toBe(
        layoutAt(targetSize, 'a-different-seed'),
      );
    }
  });
});

/**
 * The sizes a brief may ask for are the sizes the skeleton will build.
 *
 * Both ends belong to `@mtg/design-data`: the floor is where the uncommon pool
 * stops giving every color a card, the ceiling is the source profile's own set
 * size. Stating them on the field means a set nobody can build is refused where
 * it was written down, with the field named, instead of throwing a `RangeError`
 * out of the derivation once allocation has already started.
 */
describe('the target sizes a brief may ask for', () => {
  it('takes the set size the profile itself has and refuses one card more', () => {
    expect(parseBrief({ ...TEST_BRIEF, targetSize: MAX_SLICE_TARGET_SIZE }).targetSize).toBe(
      MAX_SLICE_TARGET_SIZE,
    );
    expect(() => parseBrief({ ...TEST_BRIEF, targetSize: MAX_SLICE_TARGET_SIZE + 1 })).toThrow();
  });

  it('refuses a set too small to give every color a card', () => {
    expect(parseBrief({ ...TEST_BRIEF, targetSize: MIN_SLICE_TARGET_SIZE }).targetSize).toBe(
      MIN_SLICE_TARGET_SIZE,
    );
    expect(() => parseBrief({ ...TEST_BRIEF, targetSize: MIN_SLICE_TARGET_SIZE - 1 })).toThrow();
  });
});

/**
 * A tier the profile allocated no cards to allocates no slots, and says nothing.
 *
 * The rare tier is derived per set size, so every group of it is empty below the
 * profile's rare-cycle floor. An empty group used to still be walked, and the
 * ability pass reported once per pool that the group "had no permanent slot left
 * to carry" the brief's mechanic - six sentences per mechanic, in the report a
 * designer reads, about a tier the set does not have.
 */
describe('a tier with no cards in it', () => {
  const withAbility = parseBrief({
    ...TEST_BRIEF,
    mechanics: [
      {
        name: 'Monster Drop',
        description: 'A slain Monster leaves something behind.',
        abilityKinds: ['triggered'],
        colors: ['B'],
      },
    ],
  });

  it('is a tier this profile really has none of', () => {
    expect(deriveSkeletonLite({ targetSize: brief.targetSize }).rarityTotals.rare).toBe(0);
  });

  it('allocates no slot at that rarity', () => {
    expect(allocateSlots(withAbility).slots.filter((slot) => slot.rarity === 'rare')).toStrictEqual([]);
  });

  it('files no note against it', () => {
    const rareNotes = allocateSlots(withAbility).notes.filter((note) => note.startsWith('rare '));
    expect(rareNotes).toStrictEqual([]);
  });
});

describe('allocateSlots conformance to the profile', () => {
  const full = parseBrief({ ...TEST_BRIEF, targetSize: 90 });
  const allocation = allocateSlots(full);

  it('allocates exactly one slot per card in the profile', () => {
    expect(allocation.slots).toHaveLength(SKELETON_LITE.setSize);
    expect(allocation.profile.setSize).toBe(90);
  });

  it('numbers slots uniquely and contiguously', () => {
    const numbers = allocation.slots.map((slot) => slot.collectorNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(allocation.slots.length);
    expect(new Set(allocation.slots.map((slot) => slot.id)).size).toBe(allocation.slots.length);
  });

  it('matches every group plan on card, creature and spell counts', () => {
    // Against the allocation's own profile, which is the published one after
    // archetype reservation: the validators use the same profile, so a set can
    // never be judged against a skeleton nothing was allocated from.
    for (const rarity of SLICE_RARITIES) {
      for (const color of [...COLORS, null]) {
        const plan =
          color === null ? allocation.profile.colorless[rarity] : allocation.profile.colors[color][rarity];
        const group = allocation.slots.filter((slot) => slot.rarity === rarity && slot.color === color);
        expect(group).toHaveLength(plan.cards);
        expect(group.filter((slot) => slot.cardKind === 'creature')).toHaveLength(plan.creatures);
        expect(group.filter((slot) => slot.cardKind !== 'creature')).toHaveLength(plan.spells);
      }
    }
  });

  it('keeps the published card count per group while reservation moves slots inside it', () => {
    for (const rarity of SLICE_RARITIES) {
      for (const color of COLORS) {
        expect(allocation.profile.colors[color][rarity].cards).toBe(
          SKELETON_LITE.colors[color][rarity].cards,
        );
      }
    }
    // Blue is the color the reservation has to repair: its published skeleton
    // spends four of its thirteen commons on effects DSL v0 cannot convert into
    // board presence.
    expect(allocation.profile.colors.U.common.creatures).toBeGreaterThan(
      SKELETON_LITE.colors.U.common.creatures,
    );
  });

  it('keeps every creature mana value inside a profile curve bucket', () => {
    for (const slot of allocation.slots.filter((item) => item.cardKind === 'creature')) {
      const plan =
        slot.color === null
          ? allocation.profile.colorless[slot.rarity]
          : allocation.profile.colors[slot.color][slot.rarity];
      const bucket = plan.creatureCurve.find(
        (item) => item.mvMin === slot.manaValueMin && item.mvMax === slot.manaValueMax,
      );
      expect(bucket, `${slot.id} has no matching curve bucket`).toBeDefined();
    }
  });

  it('gives colorless slots no color and no keywords, and prints their skeleton role', () => {
    const colorless = allocation.slots.filter((item) => item.color === null);
    for (const slot of colorless) {
      expect(slot.keywords).toStrictEqual([]);
      expect(['creature', 'artifact', 'sorcery', 'instant']).toContain(slot.cardKind);
      if (slot.cardKind === 'creature' || slot.cardKind === 'artifact') {
        expect(slot.effectKinds).toStrictEqual([]);
      }
    }
    // The published colorless noncreature role is expensive removal, and it is
    // the only answer a UG deck can have: the pie puts destroyPermanent and
    // dealDamage off-pie in both blue and green.
    const answers = colorless.filter((slot) => slot.effectKinds.includes('destroyPermanent'));
    expect(answers.length).toBeGreaterThan(0);
  });

  it('never allocates a keyword or effect the color pie rules off-pie', () => {
    // The allocator filters both; this asserts the filter, not the table.
    for (const slot of allocation.slots) {
      for (const keyword of slot.keywords) expect(KEYWORDS).toContain(keyword);
      if (slot.color === null) continue;
      for (const kind of slot.effectKinds) {
        expect(allowedEffectKinds(slot.role, slot.color)).toContain(kind);
      }
    }
  });

  it('prints every requested mechanic in at least one common slot', () => {
    for (const mechanic of full.mechanics) {
      const supported = allocation.slots.filter(
        (slot) => slot.rarity === 'common' && slot.mechanics.includes(mechanic.name),
      );
      expect(supported.length, `${mechanic.name} has no common slot`).toBeGreaterThan(0);
    }
  });

  it('records the keyword budget it bent, and why', () => {
    // Red carries no deathtouch in the published budget, so Glasscut has to buy one.
    expect(allocation.notes.some((note) => note.includes('Glasscut') && note.includes('deathtouch'))).toBe(
      true,
    );
  });
});

/**
 * `mtg-zd8z`. Two ways `emphasizeKeywords` can decline a mechanic's keyword
 * request used to leave no trace anywhere: a keyword entirely off the color's
 * pie, and an on-pie keyword the group's budget has no token left to buy.
 *
 * Neither reaches the flagship set - both of its mechanics name zero
 * keywords - so both are exercised here against a brief built to reach them.
 * `deathtouch` is off-pie for blue in the shipped 2021 table
 * (`classify('deathtouch', 'U').verdict === 'fail'`), and blue's own published
 * uncommon budget at `TEST_BRIEF`'s 20-card size prints zero creatures at all
 * (`allocate.test.ts`'s own `check20` measurement: `U.uncommon` is one spell
 * slot and no creature), so a keyword mechanic scoped to blue there has no
 * token anywhere in the group to spend.
 */
describe('a keyword request the allocator declines', () => {
  it('names the mechanic and the color when the keyword is off the color pie', () => {
    const offPie = parseBrief({
      ...TEST_BRIEF,
      mechanics: [
        {
          name: 'Undertow',
          description: 'Blue creatures that punish a block.',
          keywords: ['deathtouch'],
          colors: ['U'],
        },
      ],
    });
    const notes = allocateSlots(offPie).notes;
    // Narrowed to the note `emphasizeKeywords` itself writes: a bare
    // `note.includes('Undertow')` also catches an archetype-signpost
    // reservation note that names the mechanic for an unrelated reason.
    const declined = notes.filter((note) => note.includes('mechanic "Undertow"'));
    expect(declined.length).toBeGreaterThan(0);
    for (const note of declined) {
      expect(note).toContain('deathtouch');
      expect(note).toContain("U's color pie");
      expect(note).toContain('prints no such keyword here');
    }
  });

  it('names the mechanic and the group when no keyword slot is left to buy', () => {
    // Flying is on blue's pie and its common budget already carries one, so the
    // common group is silent (present); the uncommon group prints no creature
    // at all at this size, so it has no token to give up.
    const noDonor = parseBrief({
      ...TEST_BRIEF,
      mechanics: [
        {
          name: 'Windline',
          description: 'Blue fliers rule the open air.',
          keywords: ['flying'],
          colors: ['U'],
        },
      ],
    });
    const allocated = allocateSlots(noDonor);
    expect(allocated.profile.colors.U.uncommon.creatures).toBe(0);
    expect(allocated.profile.colors.U.uncommon.cards).toBeGreaterThan(0);

    const declined = allocated.notes.filter(
      (note) => note.startsWith('uncommon U:') && note.includes('Windline'),
    );
    expect(declined).toHaveLength(1);
    expect(declined[0]).toContain('flying');
    expect(declined[0]).toContain('no token to spend on it');
    expect(declined[0]).toContain('prints no such keyword here');

    // Common is silent: the color's baseline budget already carries flying.
    expect(allocated.notes.some((note) => note.startsWith('common U:') && note.includes('Windline'))).toBe(
      false,
    );
  });
});

describe('role coverage', () => {
  it('has a profile for every spell role the shipped skeleton uses', () => {
    const roles = new Set<string>();
    for (const rarity of SLICE_RARITIES) {
      for (const color of COLORS) {
        for (const role of SKELETON_LITE.colors[color][rarity].spellRoles) roles.add(role);
      }
    }
    for (const role of roles) expect(() => roleProfile(role)).not.toThrow();
  });

  it('leaves every role with at least one on-pie effect in every color that uses it', () => {
    for (const color of COLORS) {
      for (const rarity of SLICE_RARITIES) {
        for (const role of SKELETON_LITE.colors[color][rarity].spellRoles) {
          expect(allowedEffectKinds(role, color).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('names an unknown role instead of guessing a substitute', () => {
    expect(() => roleProfile('summonEldrazi')).toThrow(UnknownRoleError);
    expect(ROLE_PROFILES['summonEldrazi']).toBeUndefined();
  });
});

describe('allocateSlots input validation', () => {
  it('refuses a profile sized differently from the brief', () => {
    expect(() => allocateSlots(brief, deriveSkeletonLite({ targetSize: 40 }))).toThrow(RangeError);
  });
});
