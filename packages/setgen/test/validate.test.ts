import { describe, expect, it } from 'vitest';
import type { Card, Effect, Keyword } from '@mtg/dsl';
import { mana, parseCard, TOKEN_NAME_MAX_LENGTH } from '@mtg/dsl';
import { classify } from '@mtg/design-data';
import {
  allocateSlots,
  assembleCard,
  CARD_NAME_MAX_LENGTH,
  checkCardPie,
  checkCreatureShare,
  checkCurve,
  checkDuplicateNames,
  checkMechanicCoverage,
  checkMechanicKeywordUnprinted,
  checkNewWorldOrder,
  checkRarityTotals,
  checkSetUniqueness,
  checkSlotConformance,
  checkTertiaryBudget,
  checkTokenNames,
  DesiredMechanicSchema,
  parseBrief,
  SetBriefSchema,
  redFlagsFor,
  validateGeneratedSet,
} from '@mtg/setgen';
import type { Entry, Slot } from '@mtg/setgen';
import { synthesizeCard, TEST_BRIEF } from './helpers';

const brief = parseBrief(TEST_BRIEF);
const allocation = allocateSlots(brief);

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'CW01',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'W',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
    ...overrides,
  };
}

function card(input: Record<string, unknown>): Card {
  return parseCard({
    id: 'tst-test-card',
    name: 'Test Card',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['W'],
    manaCost: mana({ generic: 1, W: 1 }),
    ...input,
  });
}

describe('color-pie gating', () => {
  it('fails a card printing an off-pie effect for its color', () => {
    // Green is off-pie for destroyPermanent in the 2021 mechanical color pie.
    const green = card({
      kind: 'sorcery',
      colors: ['G'],
      manaCost: mana({ generic: 2, G: 1 }),
      effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
    });
    const findings = checkCardPie(slot({ color: 'G', cardKind: 'sorcery' }), green);
    expect(findings.map((item) => item.code)).toStrictEqual(['OFF_PIE']);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.slotIds).toStrictEqual(['CW01']);
  });

  it('passes the same effect in a color that carries it', () => {
    const black = card({
      kind: 'sorcery',
      colors: ['B'],
      manaCost: mana({ generic: 2, B: 1 }),
      effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
    });
    expect(checkCardPie(slot({ color: 'B', cardKind: 'sorcery' }), black)).toStrictEqual([]);
  });

  it('fails a colorless card that carries an ability at all', () => {
    const colorless = card({
      kind: 'sorcery',
      colors: [],
      manaCost: mana({ generic: 3 }),
      effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
    });
    expect(
      checkCardPie(slot({ color: null, cardKind: 'sorcery' }), colorless).map((f) => f.code),
    ).toStrictEqual(['OFF_PIE']);
  });

  /**
   * A keyword handed to the team is a subject the same way a printed one is.
   *
   * The card's own type line says nothing: `keywords` is empty and the only word
   * on it is inside a static ability. `rare-templates.test.ts` already pins the
   * *colorless* half of this, where `COLORLESS_ALLOWED_EFFECTS` decides, and the
   * colored half — where the pie table itself decides — had no test at all. That
   * is the card `mtg-bc2.26.3` said walked past the gate, so it is asserted
   * against the pie rather than against a remembered verdict: the first line
   * fails when a future edition moves the row, instead of the test quietly
   * measuring nothing.
   */
  it('rules on a keyword a colored static hands to the team', () => {
    expect(classify('deathtouch', 'W').verdict).toBe('fail');
    const grant = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: { kind: 'grantKeyword', keyword: 'deathtouch' },
    };
    const body = { kind: 'creature', power: 2, toughness: 2, artifact: false, subtypes: ['Warden'] };

    const white = card({ ...body, abilities: [grant] });
    expect(white.keywords, 'the grant is the only subject this card puts on the table').toStrictEqual([]);
    const findings = checkCardPie(slot(), white);
    expect(findings.map((item) => item.code)).toStrictEqual(['OFF_PIE']);
    expect(findings[0]?.message).toContain('deathtouch');

    expect(classify('deathtouch', 'B').verdict).not.toBe('fail');
    const black = card({ ...body, colors: ['B'], manaCost: mana({ generic: 1, B: 1 }), abilities: [grant] });
    expect(checkCardPie(slot({ color: 'B' }), black)).toStrictEqual([]);
  });

  it('warns once the tertiary budget is spent, and not before', () => {
    const usage = [
      { slotId: 'CW01', subject: 'trample' as const },
      { slotId: 'CW02', subject: 'trample' as const },
    ];
    expect(checkTertiaryBudget(usage, 2)).toStrictEqual([]);
    const over = checkTertiaryBudget(usage, 1);
    expect(over[0]?.code).toBe('TERTIARY_OVER_BUDGET');
    expect(over[0]?.severity).toBe('warning');
  });
});

describe('slot conformance', () => {
  const white = slot({ cardKind: 'creature', manaValueMin: 2, manaValueMax: 2 });

  it('accepts a card that matches its slot', () => {
    const good = card({ kind: 'creature', power: 2, toughness: 2, artifact: false });
    expect(checkSlotConformance(white, good)).toStrictEqual([]);
  });

  it('rejects the wrong color, mana value, kind and effect', () => {
    const offColor = card({
      kind: 'creature',
      colors: ['R'],
      manaCost: mana({ generic: 1, R: 1 }),
      power: 2,
      toughness: 2,
      artifact: false,
    });
    expect(checkSlotConformance(white, offColor).map((f) => f.code)).toStrictEqual(['SLOT_COLOR_MISMATCH']);

    const offCurve = card({
      kind: 'creature',
      manaCost: mana({ generic: 4, W: 1 }),
      power: 4,
      toughness: 4,
      artifact: false,
    });
    expect(checkSlotConformance(white, offCurve).map((f) => f.code)).toStrictEqual(['SLOT_MANA_VALUE_MISS']);

    const wrongKind = card({
      kind: 'instant',
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    });
    expect(checkSlotConformance(white, wrongKind).map((f) => f.code)).toContain('SLOT_KIND_MISMATCH');

    const burnInRemovalSlot = card({
      kind: 'instant',
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    });
    const removalSlot = slot({
      cardKind: 'instant',
      effectKinds: ['destroyPermanent'],
      abilityKinds: [],
      triggerConditions: [],
      role: 'removalExile',
    });
    expect(checkSlotConformance(removalSlot, burnInRemovalSlot).map((f) => f.code)).toStrictEqual([
      'SLOT_EFFECT_NOT_ALLOWED',
    ]);
  });
});

describe('New World Order gate', () => {
  const trick = (effects: unknown[]): Card =>
    card({ kind: 'instant', effects, manaCost: mana({ generic: 1, W: 1 }) });

  it('flags a common carrying two effects', () => {
    const two = trick([
      { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
    ]);
    expect(redFlagsFor(two)).toContain('multiEffect');
  });

  it('leaves a single-effect common unflagged', () => {
    expect(redFlagsFor(trick([{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }]))).toStrictEqual(
      [],
    );
  });

  it('errors when the flagged share of commons exceeds the profile budget', () => {
    const busy = trick([
      { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
    ]);
    const plain = trick([{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }]);
    const entries: Entry[] = [
      { slot: slot({ id: 'CW01' }), card: busy },
      { slot: slot({ id: 'CW02' }), card: plain },
      { slot: slot({ id: 'CW03' }), card: plain },
      { slot: slot({ id: 'CW04' }), card: plain },
    ];
    const result = checkNewWorldOrder(entries, 0.2);
    expect(result.commons).toBe(4);
    expect(result.flagged.map((flag) => flag.slotId)).toStrictEqual(['CW01']);
    expect(result.findings.map((f) => f.code)).toStrictEqual(['NWO_BUDGET_EXCEEDED']);
  });

  /**
   * The set-level half, which is the half the set brief
   * section 2.7 leans on: a budget that reads only a spell's effect list cannot
   * police a set whose commons print their text inside an ability, because a
   * generated permanent's own effect list is always empty.
   *
   * The two populations differ in one thing — whether the common carries a
   * printed ability — so the budget verdict is the difference and nothing else.
   * The share is passed in rather than read off the profile, and the count of
   * flagged commons is compared against the budget the call returns, so this
   * pins the behavior rather than either number.
   */
  it('spends the commons budget on a printed ability, not only on a printed effect', () => {
    const body = { kind: 'creature', power: 2, toughness: 2, artifact: false, subtypes: ['Warden'] };
    const plain = card(body);
    const bearing = card({
      ...body,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const pool = (subject: Card): Entry[] =>
      Array.from({ length: 40 }, (_unused, index) => ({
        slot: slot({ id: `CW${String(index + 1).padStart(2, '0')}` }),
        card: subject,
      }));

    const quiet = checkNewWorldOrder(pool(plain), 0.2);
    expect(quiet.flagged).toStrictEqual([]);
    expect(quiet.findings).toStrictEqual([]);

    const busy = checkNewWorldOrder(pool(bearing), 0.2);
    expect(busy.flagged).toHaveLength(busy.commons);
    expect(busy.flagged.length).toBeGreaterThan(busy.budget);
    expect(busy.findings.map((f) => f.code)).toStrictEqual(['NWO_BUDGET_EXCEEDED']);
  });
});

describe('set-level bands', () => {
  function entriesFor(slots: readonly Slot[], mutate?: (entry: Entry) => Entry): Entry[] {
    return slots.map((item) => {
      const assembly = assembleCard(item, synthesizeCard(item), brief.setCode);
      if (assembly.card === undefined) {
        throw new Error(`synthesized card for ${item.id} is invalid: ${JSON.stringify(assembly.violations)}`);
      }
      const entry: Entry = { slot: item, card: assembly.card };
      return mutate === undefined ? entry : mutate(entry);
    });
  }

  function entriesFromAllocation(mutate?: (entry: Entry) => Entry): Entry[] {
    return entriesFor(allocation.slots, mutate);
  }

  it('passes a set built exactly to the skeleton', () => {
    const entries = entriesFromAllocation();
    expect(checkCreatureShare(entries, allocation.profile)).toStrictEqual([]);
    expect(checkCurve(entries, allocation.profile)).toStrictEqual([]);
    expect(checkRarityTotals(entries, allocation.profile)).toStrictEqual([]);
    expect(checkDuplicateNames(entries)).toStrictEqual([]);
    expect(checkMechanicCoverage(entries, brief.mechanics)).toStrictEqual([]);
  });

  /**
   * Measured on a set whose groups are large enough to drift.
   *
   * The band is +/-1 creature, and the rest of this describe builds the
   * twenty-card fixture, where a color's common group holds two cards and one of
   * them is the creature. Deleting every white common creature there moves the
   * group by exactly one, which the tolerance is meant to forgive, so the check
   * correctly said nothing and the test read as a regression in the check. It
   * was a fixture too small to express the fault. Ninety cards gives white ten
   * commons and the deletion is unmistakable.
   */
  it('catches a color whose creature count drifts off the plan', () => {
    const full = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize: 90 }));
    const entries = entriesFor(full.slots);
    const trimmed = entries.filter(
      (entry) =>
        !(entry.slot.color === 'W' && entry.slot.rarity === 'common' && entry.card.kind === 'creature'),
    );
    expect(entries.length - trimmed.length).toBeGreaterThan(1);
    const findings = checkCreatureShare(trimmed, full.profile);
    expect(findings.map((f) => f.code)).toContain('CREATURE_SHARE_BAND');
  });

  it('catches a rarity total that does not match the profile', () => {
    const entries = entriesFromAllocation().slice(0, -1);
    expect(checkRarityTotals(entries, allocation.profile).map((f) => f.code)).toContain(
      'RARITY_DISTRIBUTION',
    );
  });

  it('checks every tier the profile allocates, the rare one included', () => {
    // `mtg-lqyu`: the check looped a hardcoded pair of tier names, so a set
    // printing 18 or 20 rares against a planned 19 passed clean. It did not
    // throw; it stopped checking. The tiers come off `SLICE_RARITIES` now, so a
    // fourth tier is checked the day the skeleton allocates one.
    const big = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize: 250 }));
    expect(big.profile.rarityTotals.rare).toBeGreaterThan(0);
    const entries = big.slots.map((item) => {
      const assembly = assembleCard(item, synthesizeCard(item), brief.setCode);
      if (assembly.card === undefined) throw new Error(`synthesized card for ${item.id} is invalid`);
      return { slot: item, card: assembly.card };
    });
    expect(checkRarityTotals(entries, big.profile)).toStrictEqual([]);
    const oneRareShort = entries.filter(
      (entry, index) =>
        entry.card.rarity !== 'rare' || index !== entries.findIndex((e) => e.card.rarity === 'rare'),
    );
    const findings = checkRarityTotals(oneRareShort, big.profile);
    expect(findings.map((finding) => finding.code)).toStrictEqual(['RARITY_DISTRIBUTION']);
    expect(findings[0]?.message).toContain('rare');
  });

  it('reports a card promoted to mythic against a profile that allocates none', () => {
    // The check used to loop `SLICE_RARITIES`, so a mythic was counted in no
    // tier at all: promoting a rare reported the rare tier one short and said
    // nothing about the mythic that took its place. Both halves are findings.
    const big = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize: 250 }));
    const entries = big.slots.map((item) => {
      const assembly = assembleCard(item, synthesizeCard(item), brief.setCode);
      if (assembly.card === undefined) throw new Error(`synthesized card for ${item.id} is invalid`);
      return { slot: item, card: assembly.card };
    });
    const rareIndex = entries.findIndex((entry) => entry.card.rarity === 'rare');
    expect(rareIndex).toBeGreaterThanOrEqual(0);
    const promoted = entries.map((entry, index) =>
      index === rareIndex ? { ...entry, card: { ...entry.card, rarity: 'mythic' as const } } : entry,
    );
    const findings = checkRarityTotals(promoted, big.profile);
    const messages = findings.map((item) => item.message);
    expect(messages.some((message) => message.includes('1 mythics'))).toBe(true);
    expect(messages.some((message) => message.includes('mythics; the profile allocates 0'))).toBe(true);
    // And it names the promoted card's slot rather than an empty list.
    const mythicFinding = findings.find((item) => item.message.includes('mythic'));
    expect(mythicFinding?.slotIds).toContain(promoted[rareIndex]?.slot.id);
  });

  it('catches duplicate names and functional reprints', () => {
    const entries = entriesFromAllocation();
    const first = entries[0];
    const second = entries[1];
    if (first === undefined || second === undefined) throw new Error('allocation is too small for this test');
    const cloned: Entry[] = [
      first,
      { slot: second.slot, card: { ...first.card, id: 'tst-clone', set: second.card.set } },
      ...entries.slice(2),
    ];
    expect(checkDuplicateNames(cloned).map((f) => f.code)).toContain('DUPLICATE_NAME');
    expect(checkSetUniqueness(cloned).map((f) => f.code)).toContain('DUPLICATE_MECHANICS');
  });

  it('catches one token name printed with two incompatible shapes (mtg-i33s)', () => {
    const entries = entriesFromAllocation();
    const first = entries[0];
    const second = entries[1];
    if (first === undefined || second === undefined) throw new Error('allocation is too small for this test');

    const keyCreature: Effect = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Key', power: 0, toughness: 1, colors: [], subtypes: ['Key'], keywords: [] },
    };
    const keyArtifact: Effect = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Key', colors: [], subtypes: ['Key'], keywords: [] },
    };
    const mutated: Entry[] = [
      { slot: first.slot, card: { ...first.card, effects: [...first.card.effects, keyCreature] } },
      { slot: second.slot, card: { ...second.card, effects: [...second.card.effects, keyArtifact] } },
      ...entries.slice(2),
    ];

    const findings = checkTokenNames(mutated);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('DUPLICATE_TOKEN_NAME');
    expect(findings[0]?.severity).toBe('error');
    expect([...(findings[0]?.slotIds ?? [])].sort()).toEqual([first.slot.id, second.slot.id].sort());
    expect(findings[0]?.message).toContain('Key');
  });

  it('leaves two cards agreeing on one token name clean', () => {
    const entries = entriesFromAllocation();
    const first = entries[0];
    const second = entries[1];
    if (first === undefined || second === undefined) throw new Error('allocation is too small for this test');

    const key: Effect = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Key', power: 0, toughness: 1, colors: [], subtypes: ['Key'], keywords: [] },
    };
    const mutated: Entry[] = [
      { slot: first.slot, card: { ...first.card, effects: [...first.card.effects, key] } },
      { slot: second.slot, card: { ...second.card, effects: [...second.card.effects, key] } },
      ...entries.slice(2),
    ];

    expect(checkTokenNames(mutated)).toStrictEqual([]);
  });

  it('reports a mechanic that never reaches a common', () => {
    const entries = entriesFromAllocation();
    // The slots stay allocated to Skywake; the cards printed in them stop carrying it.
    const stripped = entries.map((entry) =>
      entry.slot.mechanics.includes('Skywake') ? { ...entry, card: { ...entry.card, keywords: [] } } : entry,
    );
    const findings = checkMechanicCoverage(stripped, brief.mechanics);
    expect(findings.map((f) => f.code)).toContain('MECHANIC_ABSENT_AT_COMMON');
  });

  /**
   * `MECHANIC_UNPLACEABLE` names the vocabularies a mechanic can be stated in,
   * and it named two of them when there were three (`mtg-km5o`). Nothing writes
   * that list down, so it is derived here instead: a vocabulary is a field of
   * `DesiredMechanicSchema` that, stated on its own, makes a valid brief.
   *
   * `triggerConditions` is a field and is not one of them, which is the half of
   * the bead that did not survive the schema. It is absent from the "at least
   * one" refinement, and a second refinement requires a mechanic naming
   * conditions to also name `triggered` among its ability kinds, so a condition
   * narrows a trigger rather than stating a mechanic. `mechanicMatches` reads
   * the same three the message now names, and `checkTriggerConditions`
   * (`conformance.ts`) is where a stated condition is read back.
   */
  it('names in MECHANIC_UNPLACEABLE every vocabulary a mechanic can be stated in', () => {
    const samples: Readonly<Record<string, readonly string[]>> = {
      keywords: ['flying'],
      effectKinds: ['dealDamage'],
      abilityKinds: ['static'],
      triggerConditions: ['selfEnters'],
      colors: ['W'],
    };
    const shape: Readonly<Record<string, { safeParse: (value: unknown) => { success: boolean } }>> =
      DesiredMechanicSchema.shape;
    const listFields = Object.keys(shape).filter((field) => shape[field]?.safeParse([]).success === true);
    expect([...listFields].sort()).toEqual(Object.keys(samples).sort());

    const statesAMechanic = listFields.filter(
      (field) =>
        SetBriefSchema.safeParse({
          ...TEST_BRIEF,
          mechanics: [{ name: 'Probe', description: 'One vocabulary at a time.', [field]: samples[field] }],
        }).success,
    );
    expect([...statesAMechanic].sort()).toEqual(['abilityKinds', 'effectKinds', 'keywords']);

    const probe = parseBrief({
      ...TEST_BRIEF,
      mechanics: [
        { name: 'Probe', description: 'One vocabulary at a time.', keywords: ['flying'], colors: ['W'] },
      ],
    }).mechanics;
    const [unplaceable, ...rest] = checkMechanicCoverage([], probe);
    expect(rest).toStrictEqual([]);
    expect(unplaceable?.code).toBe('MECHANIC_UNPLACEABLE');

    // `effectKinds` is the phrase "effect kinds", so a fourth vocabulary would
    // have to be named in the message under the same rule.
    const phrase = (field: string): string => field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    for (const field of statesAMechanic) expect(unplaceable?.message).toContain(phrase(field));
    expect(unplaceable?.message).not.toContain(phrase('triggerConditions'));
  });
});

/**
 * `checkMechanicKeywordUnprinted`, read off the finished entries rather than
 * the allocator's own note.
 *
 * `mtg-zd8z`: `emphasizeKeywords` (`allocate.ts`) declines a mechanic's
 * keyword request two ways — see `allocate.test.ts`'s "a keyword request the
 * allocator declines" for the allocator-side half of this fix — and this is
 * the validate-side half. It re-derives the same claim from what the set
 * actually prints instead of from the allocator's private note, because a
 * later pass (`archetype/assign.ts`'s `stampKeyword`) can still hand a
 * signpost the exact keyword this pass declined to buy, and a finding raised
 * off the note alone would then be a false positive.
 */
describe('a mechanic keyword the set does not print', () => {
  function entriesFor(built: ReturnType<typeof allocateSlots>): Entry[] {
    return built.slots.map((item) => {
      const assembly = assembleCard(item, synthesizeCard(item), built.brief.setCode);
      if (assembly.card === undefined) {
        throw new Error(`synthesized card for ${item.id} is invalid: ${JSON.stringify(assembly.violations)}`);
      }
      return { slot: item, card: assembly.card };
    });
  }

  it('warns once, naming the color, when the keyword is entirely off pie', () => {
    // Same brief `allocate.test.ts` uses to reach the off-pie branch: deathtouch
    // is off blue's pie in the shipped 2021 table, so no rarity's group can ever
    // carry it, whatever a later pass does.
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
    const built = allocateSlots(offPie);
    const findings = checkMechanicKeywordUnprinted(entriesFor(built), built.slots, offPie.mechanics);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('MECHANIC_KEYWORD_UNPRINTED');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('Undertow');
    expect(findings[0]?.message).toContain('deathtouch');
    expect(findings[0]?.message).toContain('U');
    expect(findings[0]?.slotIds).toStrictEqual([]);
  });

  it('warns for the one group whose budget had no token to buy the keyword with', () => {
    // Same brief `allocate.test.ts` uses to reach the no-donor branch: at
    // TEST_BRIEF's 20-card size, blue's uncommon group prints one spell and no
    // creature at all, so its keyword budget is all zero and has nothing to
    // donate; blue's common already carries flying, so it stays silent.
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
    const built = allocateSlots(noDonor);
    expect(built.profile.colors.U.uncommon.creatures).toBe(0);

    const findings = checkMechanicKeywordUnprinted(entriesFor(built), built.slots, noDonor.mechanics);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('MECHANIC_KEYWORD_UNPRINTED');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('Windline');
    expect(findings[0]?.message).toContain('flying');
    expect(findings[0]?.message).toContain('uncommon');
  });

  it('is silent when a later pass hands the group the keyword the allocator declined', () => {
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
    const built = allocateSlots(noDonor);
    const flying: Keyword[] = ['flying'];
    // Nothing in `allocate.ts` printed this — it stands in for a downstream pass
    // (`stampKeyword`) placing the keyword by a route the allocator's own note
    // never sees, which is exactly why the check has to read the card, not the
    // note.
    const stamped = entriesFor(built).map((entry) =>
      entry.slot.rarity === 'uncommon' && entry.slot.color === 'U'
        ? { ...entry, card: { ...entry.card, keywords: flying } }
        : entry,
    );
    expect(checkMechanicKeywordUnprinted(stamped, built.slots, noDonor.mechanics)).toStrictEqual([]);
  });

  it('reaches the report through the whole validator, as a warning that does not fail the set', () => {
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
    const built = allocateSlots(noDonor);
    const cards = new Map<string, Card>();
    for (const item of built.slots) {
      const assembly = assembleCard(item, synthesizeCard(item), noDonor.setCode);
      if (assembly.card !== undefined) cards.set(item.id, assembly.card);
    }
    const result = validateGeneratedSet({ allocation: built, cards, tertiaryBudget: 20 });
    const found = result.findings.filter((f) => f.code === 'MECHANIC_KEYWORD_UNPRINTED');
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('warning');
    expect(result.ok, JSON.stringify(result.findings, null, 2)).toBe(true);
    expect(result.failingSlotIds).toStrictEqual([]);
  });

  it('never fires when the brief names no keyword, the shape of the flagship brief', () => {
    // mtg-zd8z's own non-regression: the flagship set's own mechanics name
    // zero keywords, and this check must never fire on that shape whatever the
    // finished cards look like. `TEST_BRIEF`'s stock mechanics do name keywords
    // (Skywake, Glasscut, Rootbound), so it is not this brief unmodified — it is
    // the same brief with every mechanic's keyword list emptied, the exact
    // shape the check has to be silent on.
    const noKeywords = parseBrief({
      ...TEST_BRIEF,
      // A mechanic must still name at least one keyword, effect kind or ability
      // kind (`brief.ts`'s own refine); `static` stands in so the keyword list
      // itself can go empty without the brief failing to parse.
      mechanics: TEST_BRIEF.mechanics.map((mechanic) => ({
        ...mechanic,
        keywords: [],
        abilityKinds: ['static' as const],
      })),
    });
    const built = allocateSlots(noKeywords);
    expect(built.brief.mechanics.flatMap((mechanic) => mechanic.keywords)).toStrictEqual([]);
    const entries = entriesFor(built);
    expect(checkMechanicKeywordUnprinted(entries, built.slots, noKeywords.mechanics)).toStrictEqual([]);
  });
});

describe('validateGeneratedSet', () => {
  it('passes a fully synthesized set and reports no failing slots', () => {
    const cards = new Map<string, Card>();
    for (const item of allocation.slots) {
      const assembly = assembleCard(item, synthesizeCard(item), brief.setCode);
      if (assembly.card !== undefined) cards.set(item.id, assembly.card);
    }
    const result = validateGeneratedSet({ allocation, cards, tertiaryBudget: 20 });
    expect(result.ok, JSON.stringify(result.findings, null, 2)).toBe(true);
    expect(result.failingSlotIds).toStrictEqual([]);
    expect(result.entries).toHaveLength(allocation.slots.length);
  });

  it('blames the empty slot when a card is missing', () => {
    const result = validateGeneratedSet({
      allocation,
      cards: new Map<string, Card>(),
      tertiaryBudget: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === 'SLOT_UNFILLED')).toBe(true);
    expect(result.failingSlotIds).toContain(allocation.slots[0]?.id);
  });
});

/**
 * Two name bounds, one face.
 *
 * `CARD_NAME_MAX_LENGTH` bounds what the model may answer with for a card;
 * `@mtg/dsl`'s `TOKEN_NAME_MAX_LENGTH` bounds the name it may give a token. They
 * are separate numbers because they answer to different evidence — the card
 * bound is a design choice about the brief, the token bound is what the card
 * store measures — but a token is drawn on the card face, so a token name may
 * never be allowed to be longer than a card name. The relation is asserted here
 * rather than in `@mtg/dsl`, which must not import this package.
 */
describe('the token name bound against the card name bound', () => {
  it('never lets a token be named longer than a card', () => {
    expect(TOKEN_NAME_MAX_LENGTH).toBeLessThanOrEqual(CARD_NAME_MAX_LENGTH);
  });
});
