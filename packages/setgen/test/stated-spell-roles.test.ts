/**
 * A brief that states a tier's spell roles, and a brief that states none.
 *
 * `mtg-j3bp`. A group's spell roles are `cycleRoles(profile.spellSlots, spells)`
 * over a list the published profile only has at common, so a tier printing one
 * spell prints whatever a common pool leads with. That is right at common and
 * wrong at the tier a set may print a bomb at, and which roles a tier deserves
 * is design judgment rather than a transform, so the brief states them.
 *
 * Two properties carry the whole feature and both are checked here by
 * construction rather than by reading the code. A brief that states nothing gets
 * the same profile object back, which is what every other brief, every fixture
 * and the committed 75-card build depend on. And a stated role is an *input* to
 * the three reservation passes rather than an override of them, which is
 * observable: state a role whose effects cannot touch the battlefield and the
 * archetype reservation still converts it to a body, exactly as it would have
 * converted the profile's own.
 */
import { describe, expect, it } from 'vitest';
import type { SkeletonLiteProfile, SliceGroupPlan } from '@mtg/design-data';
import {
  deriveSkeletonLite,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  SLICE_RARITIES,
} from '@mtg/design-data';
import { exampleCard } from '@mtg/dsl';
import type { Entry, SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import {
  allocateSlots,
  applyStatedSpellRoles,
  checkStatedRoles,
  failingSlotIds,
  parseBrief,
  SPELL_ROLE_NAMES,
  validateGeneratedSet,
} from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

/** Large enough that the derivation prints a rare tier; the default 90 does not. */
const LARGE = 250;

function briefWith(overrides: Partial<SetBriefInput>): SetBrief {
  return parseBrief({ ...TEST_BRIEF, targetSize: LARGE, ...overrides });
}

function profileFor(brief: SetBrief): SkeletonLiteProfile {
  return deriveSkeletonLite({ targetSize: brief.targetSize });
}

function rareSpells(slots: readonly Slot[], color: string): Slot[] {
  return slots.filter(
    (slot) => slot.rarity === 'rare' && slot.color === color && slot.cardKind !== 'creature',
  );
}

describe('a brief that states nothing', () => {
  it('gets the same profile object back, with nothing to report', () => {
    const brief = briefWith({});
    const profile = profileFor(brief);
    const applied = applyStatedSpellRoles(profile, brief);
    expect(applied.profile).toBe(profile);
    expect(applied.notes).toStrictEqual([]);
  });

  it('allocates the same slots whether the field is absent or empty', () => {
    const absent = allocateSlots(briefWith({}));
    const empty = allocateSlots(briefWith({ spellRoles: [] }));
    expect(empty.slots).toStrictEqual(absent.slots);
    expect(empty.notes).toStrictEqual(absent.notes);
  });
});

/**
 * Which tiers a role reaches when no brief states anything, measured rather than
 * read off the table.
 *
 * `mtg-7u5l` was filed as "removalOvercosted cannot structurally be a rare", on
 * the belief that the role catalogue gives that role a rarity ceiling under the
 * rare tier. It gives none, and could not: `RoleProfile` has no rarity field at
 * all, and a group's roles are `cycleRoles` walking its color's *common* list
 * from the head, so a role's reach is its position in that list against the
 * spell slots the tier was allocated. Five roles sit past the longest group
 * under common — the tail of each color's list — and the ceiling looks like a
 * fact about `removalOvercosted` only until the other four are measured beside
 * it. The last case here is the claim itself, refuted.
 */
describe('the tiers a role reaches with no brief statement', () => {
  const reach = new Map<string, Set<string>>();
  for (let size = MIN_SLICE_TARGET_SIZE; size <= MAX_SLICE_TARGET_SIZE; size += 1) {
    const profile = deriveSkeletonLite({ targetSize: size });
    for (const plans of [...Object.values(profile.colors), profile.colorless]) {
      for (const rarity of SLICE_RARITIES) {
        for (const role of plans[rarity].spellRoles) {
          const seen = reach.get(role) ?? new Set<string>();
          seen.add(rarity);
          reach.set(role, seen);
        }
      }
    }
  }

  /** Every rarity that seats `role` in any pool, at any size the derivation builds. */
  function raritiesReaching(role: string): string[] {
    return [...(reach.get(role) ?? new Set<string>())].sort();
  }

  it('reaches removalOvercosted at common alone, at every size the derivation builds', () => {
    expect(raritiesReaching('removalOvercosted')).toStrictEqual(['common']);
  });

  it('does the same to the tail of the other four lists, so the reach is the position', () => {
    for (const role of ['removalArtifactEnchantment', 'modalSpell', 'burnSixForFive', 'dig']) {
      expect(raritiesReaching(role), role).toStrictEqual(['common']);
    }
    // The head of the same black list reaches every tier there is, off the same
    // table and the same walk. Nothing about either role separates them.
    expect(raritiesReaching('removalSmallConditional')).toStrictEqual(['common', 'rare', 'uncommon']);
  });

  it('seats removalOvercosted at rare the moment a brief states it there', () => {
    const brief = briefWith({
      spellRoles: [
        { rarity: 'rare', pool: 'W', roles: ['removalOvercosted'], why: 'white answers late and dearly.' },
      ],
    });
    const spells = rareSpells(allocateSlots(brief).slots, 'W');
    expect(spells.map((slot) => slot.role)).toStrictEqual(['removalOvercosted']);
    expect(spells[0]?.cardKind).toBe('instant');
    expect([spells[0]?.manaValueMin, spells[0]?.manaValueMax]).toStrictEqual([4, 5]);
  });
});

describe('a brief that states one tier', () => {
  const stated = briefWith({
    spellRoles: [
      { rarity: 'rare', pool: 'B', roles: ['burnSixForFive'], why: 'the tier prints the biggest number.' },
    ],
  });

  it('prints the stated role in that tier and pool', () => {
    const spells = rareSpells(allocateSlots(stated).slots, 'B');
    expect(spells.map((slot) => slot.role)).toStrictEqual(['burnSixForFive']);
  });

  it('leaves the same tier of every other pool exactly where it was', () => {
    const bare = allocateSlots(briefWith({}));
    const other = allocateSlots(stated);
    for (const color of ['W', 'U', 'R', 'G']) {
      expect(rareSpells(other.slots, color).map((slot) => slot.role)).toStrictEqual(
        rareSpells(bare.slots, color).map((slot) => slot.role),
      );
    }
  });

  it('moves the roles and nothing else about the group', () => {
    const profile = profileFor(stated);
    const before: SliceGroupPlan = profile.colors.B.rare;
    const after = applyStatedSpellRoles(profile, stated).profile.colors.B.rare;
    expect(after.cards).toBe(before.cards);
    expect(after.creatures).toBe(before.creatures);
    expect(after.spells).toBe(before.spells);
    expect(after.creatureCurve).toStrictEqual(before.creatureCurve);
    expect(after.keywords).toStrictEqual(before.keywords);
    expect(after.spellRoles).not.toStrictEqual(before.spellRoles);
  });

  it('reports what it replaced and the reason the brief gave', () => {
    const note = allocateSlots(stated).notes.find((line) => line.includes('the brief states'));
    expect(note).toContain('rare B');
    expect(note).toContain('burnSixForFive');
    expect(note).toContain('the tier prints the biggest number.');
  });
});

describe('the roles cycle over the slots the skeleton allocated', () => {
  /**
   * Blue's rare group holds two spell slots at this size, so one stated role has
   * to fill both. Stating the count instead would make every brief wrong at
   * every other set size, which is the failure `pins.ts` already exists to end.
   */
  it('repeats one stated role across a tier that holds two spells', () => {
    const brief = briefWith({
      spellRoles: [{ rarity: 'rare', pool: 'U', roles: ['manaAcceleration'], why: 'blue prints a body.' }],
    });
    const plan = applyStatedSpellRoles(profileFor(brief), brief).profile.colors.U.rare;
    expect(plan.spells).toBe(2);
    expect(plan.spellRoles).toStrictEqual(['manaAcceleration', 'manaAcceleration']);
  });

  it('truncates a list longer than the tier, and names what it dropped', () => {
    const brief = briefWith({
      spellRoles: [
        {
          rarity: 'rare',
          pool: 'W',
          roles: ['removalOvercosted', 'removalExile', 'removalUnconditional'],
          why: 'white answers unconditionally.',
        },
      ],
    });
    const applied = applyStatedSpellRoles(profileFor(brief), brief);
    const plan = applied.profile.colors.W.rare;
    expect(plan.spells).toBe(1);
    expect(plan.spellRoles).toStrictEqual(['removalOvercosted']);

    // The drop used to be the one silent path in this pass. A rare pool holds at
    // most two spell slots at any set size and the schema takes eight roles, so
    // an author can lose six of them; the note is what makes that readable
    // without counting slots by hand.
    expect(applied.notes).toHaveLength(1);
    expect(applied.notes[0]).toContain('1 spell slot(s)');
    expect(applied.notes[0]).toContain('states 3 role(s)');
    expect(applied.notes[0]).toContain('removalExile, removalUnconditional did not fit');
  });

  it('says nothing about a drop when the whole statement fits', () => {
    const brief = briefWith({
      spellRoles: [{ rarity: 'common', pool: 'W', roles: ['removalExile'], why: 'white exiles.' }],
    });
    const applied = applyStatedSpellRoles(profileFor(brief), brief);
    expect(applied.notes).toHaveLength(1);
    expect(applied.notes[0]).not.toContain('did not fit');
  });
});

describe('a stated role is an input to the reservations, not an override of them', () => {
  /**
   * `counterspell` is battlefield-inert in DSL v0 and a color may print at most
   * `inertCapPerColor` such cards before its archetypes play blanks. The pass
   * runs before `reserveArchetypes`, so a stated inert role is capped like any
   * other and converted to a body. Running the pass last instead would hide the
   * conversion here and fail the finished set at `checkArchetypeViability`.
   */
  it('lets the inert budget convert a stated counterspell into a creature', () => {
    const brief = briefWith({
      spellRoles: [
        { rarity: 'rare', pool: 'U', roles: ['counterspell'], why: 'blue answers before it lands.' },
      ],
    });
    const allocation = allocateSlots(brief);
    expect(rareSpells(allocation.slots, 'U')).toStrictEqual([]);
    expect(allocation.notes.some((line) => line.includes('cannot touch the battlefield'))).toBe(true);
  });
});

describe('a tier the skeleton did not build', () => {
  /**
   * The rare tier is derived per set size and a small set has none, which the
   * allocator already declines to say anything about when it skips an empty
   * group: a note per stated pool would be six sentences about a tier the set
   * does not have.
   */
  it('is silent, and changes nothing', () => {
    const brief = parseBrief({
      ...TEST_BRIEF,
      targetSize: 90,
      spellRoles: [{ rarity: 'rare', pool: 'G', roles: ['manaAcceleration'], why: 'green prints a body.' }],
    });
    const profile = profileFor(brief);
    expect(profile.colors.G.rare.cards).toBe(0);
    const applied = applyStatedSpellRoles(profile, brief);
    expect(applied.profile).toBe(profile);
    expect(applied.notes).toStrictEqual([]);
  });
});

/**
 * The finished set, read back against the statement that asked for it.
 *
 * A note is the allocator's own record and nobody greps notes. The decision
 * behind `checkStatedRoles` is that a stated role stays a *request* rather than
 * becoming a constraint the allocator fails on - a rare pool holds at most two
 * spell slots at any size the derivation builds, so an author can legally state
 * more than the skeleton can hold, and a generator that refuses to run is worse
 * than one that runs and says what it could not fit. So the outcome is a
 * warning: nothing regenerates, the set still ships, and the report names the
 * card the brief asked for and the set does not print.
 */
describe('a stated role the set does not print', () => {
  const CARD = exampleCard('slc-skywatch-sentinel');

  function entriesFor(slots: readonly Slot[]): Entry[] {
    return slots.map((slot) => ({ slot, card: CARD }));
  }

  it('is reported by role name, with what the group printed instead', () => {
    const brief = briefWith({
      spellRoles: [
        {
          rarity: 'rare',
          pool: 'W',
          roles: ['removalOvercosted', 'removalExile', 'removalUnconditional'],
          why: 'white answers unconditionally.',
        },
      ],
    });
    const allocation = allocateSlots(brief);
    const findings = checkStatedRoles(entriesFor(allocation.slots), allocation.slots, brief.spellRoles);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('STATED_ROLE_UNPRINTED');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('removalExile or removalUnconditional');
    expect(findings[0]?.message).toContain('white answers unconditionally.');
    // A warning names no slot, so nothing is regenerated to chase it.
    expect(failingSlotIds(findings)).toStrictEqual([]);
  });

  it('says nothing when the tier prints what the brief asked for', () => {
    const brief = briefWith({
      spellRoles: [
        { rarity: 'rare', pool: 'W', roles: ['removalOvercosted'], why: 'white answers late and dearly.' },
      ],
    });
    const allocation = allocateSlots(brief);
    expect(checkStatedRoles(entriesFor(allocation.slots), allocation.slots, brief.spellRoles)).toStrictEqual(
      [],
    );
  });

  /**
   * The same silence `applyStatedSpellRoles` keeps for a group the skeleton did
   * not build. A brief stating rare roles and then built at 90 cards is
   * describing a tier the set does not have, which is not a missing card.
   */
  it('is silent about a tier this set size has no slots for', () => {
    const brief = parseBrief({
      ...TEST_BRIEF,
      targetSize: 90,
      spellRoles: [{ rarity: 'rare', pool: 'G', roles: ['manaAcceleration'], why: 'green prints a body.' }],
    });
    const allocation = allocateSlots(brief);
    expect(allocation.slots.some((slot) => slot.rarity === 'rare')).toBe(false);
    expect(checkStatedRoles(entriesFor(allocation.slots), allocation.slots, brief.spellRoles)).toStrictEqual(
      [],
    );
  });

  it('reaches the report through the whole validator, as a warning', () => {
    const brief = briefWith({
      spellRoles: [
        { rarity: 'rare', pool: 'U', roles: ['counterspell'], why: 'blue answers before it lands.' },
      ],
    });
    const allocation = allocateSlots(brief);
    const validation = validateGeneratedSet({
      allocation,
      cards: new Map(allocation.slots.map((slot) => [slot.id, CARD])),
      tertiaryBudget: 999,
    });
    const stated = validation.findings.filter((item) => item.code === 'STATED_ROLE_UNPRINTED');

    // The inert cap converted the stated counterspell to a body, which the
    // allocator noted; this is the same fact where a reader of the set will
    // actually meet it.
    expect(stated).toHaveLength(1);
    expect(stated[0]?.severity).toBe('warning');
    expect(stated[0]?.message).toContain('counterspell');
    expect(stated[0]?.slotIds).toStrictEqual([]);
  });
});

describe('the boundary refuses what the allocator could not seat', () => {
  it('names an unknown role and lists the ones it can seat', () => {
    expect(() =>
      briefWith({
        spellRoles: [
          { rarity: 'rare', pool: 'W', roles: ['removalMassive'], why: 'white sweeps the board.' },
        ],
      }),
    ).toThrow(/unknown spell role \W*removalMassive\W*: the allocator can seat/);
  });

  it('accepts the artifact roles the profile names, which carry no effect table', () => {
    expect(SPELL_ROLE_NAMES).toContain('manaArtifact');
    const brief = briefWith({
      spellRoles: [
        { rarity: 'rare', pool: 'colorless', roles: ['manaArtifact'], why: 'the rares are gear.' },
      ],
    });
    const gear = allocateSlots(brief).slots.filter(
      (slot) => slot.rarity === 'rare' && slot.color === null && slot.cardKind === 'artifact',
    );
    expect(gear.length).toBeGreaterThan(0);
    expect(gear.every((slot) => slot.role === 'manaArtifact')).toBe(true);
  });

  it('refuses two statements about one tier of one pool', () => {
    expect(() =>
      briefWith({
        spellRoles: [
          { rarity: 'rare', pool: 'R', roles: ['burnFour'], why: 'red burns.' },
          { rarity: 'rare', pool: 'R', roles: ['burnSixForFive'], why: 'red burns harder.' },
        ],
      }),
    ).toThrow(/spell roles stated twice for rare R/);
  });

  it('refuses an empty role list, which states nothing while looking like a statement', () => {
    expect(() =>
      briefWith({ spellRoles: [{ rarity: 'rare', pool: 'R', roles: [], why: 'red states nothing.' }] }),
    ).toThrow();
  });
});
