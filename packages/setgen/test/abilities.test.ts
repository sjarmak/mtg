/**
 * The generator asking for an ability.
 *
 * Five things have to be true together, and they are separable, so they are
 * tested separately: the allocator reserves a permanent slot for a mechanic
 * stated as an ability kind; the prompt for that batch, and only that batch,
 * explains what an ability is; the answer schema widens for that batch, and only
 * that batch, which is what leaves every fixture recorded before this change
 * still keyed to the request it stores; assembly carries the ability onto the
 * card; and the set-level gates read it back.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toJsonSchema } from '@mtg/llm';
import { classify } from '@mtg/design-data';
import { KEYWORDS, ModelAbilitySchema, parseCard, validateCard } from '@mtg/dsl';
import type { AbilityKind, Card, Color, ModelAbility } from '@mtg/dsl';
import {
  allocateSlots,
  assembleCard,
  batchSlots,
  buildFillPrompt,
  checkMechanicCoverage,
  checkSlotConformance,
  FillBatchSchema,
  FillBatchWithAbilitiesSchema,
  FilledCardSchema,
  fillSchemaFor,
  parseBrief,
} from '@mtg/setgen';
import type { DesiredMechanic, FilledCard, SetBrief, Slot } from '@mtg/setgen';
import { checkNewWorldOrder, redFlagsFor } from '../src/validate/nwo';
import { TEST_BRIEF } from './helpers';
import { checkCardPie } from '../src/validate/pie';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const briefAt = (name: string): SetBrief =>
  parseBrief(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'briefs', name), 'utf8')) as unknown);

const HEARTHGLASS = briefAt('hearthglass-vigil.json');
const TIDEGLASS = briefAt('tideglass-reach.json');

/** A mechanic stating one vocabulary and defaulting the rest, as a brief may. */
function mechanic(stated: Partial<DesiredMechanic>): DesiredMechanic {
  return {
    name: 'Fuse',
    description: 'A part is spent, not worn.',
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    triggerConditions: [],
    colors: [],
    ...stated,
  };
}

function promptFor(brief: SetBrief, slots: readonly Slot[]): string {
  const allocation = allocateSlots(brief);
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

describe('the allocator, asked for a mechanic stated as an ability', () => {
  const allocation = allocateSlots(HEARTHGLASS);
  const withAbilities = allocation.slots.filter((slot) => slot.abilityKinds.length > 0);

  it('reserves a common permanent slot in every color the mechanic named', () => {
    for (const mechanic of HEARTHGLASS.mechanics) {
      if (mechanic.abilityKinds.length === 0) continue;
      for (const color of mechanic.colors) {
        const commons = withAbilities.filter(
          (slot) =>
            slot.rarity === 'common' && slot.color === color && slot.mechanics.includes(mechanic.name),
        );
        expect(commons.length, `${mechanic.name} has no common slot in ${color}`).toBeGreaterThan(0);
        for (const slot of commons) expect(slot.abilityKinds).toStrictEqual(mechanic.abilityKinds);
      }
    }
  });

  it('only ever puts one on a permanent, because that is where an ability may be printed', () => {
    for (const slot of withAbilities) expect(['creature', 'artifact']).toContain(slot.cardKind);
  });

  it('says in its notes which slot carries which mechanic', () => {
    for (const slot of withAbilities) {
      expect(allocation.notes.some((note) => note.includes(slot.id))).toBe(true);
    }
  });

  it('leaves every slot ability-free for a brief that names no ability kind', () => {
    expect(allocateSlots(TIDEGLASS).slots.every((slot) => slot.abilityKinds.length === 0)).toBe(true);
  });
});

describe('the answer schema a batch is shown', () => {
  it('is the unchanged one for every batch of a brief that names no ability kind', () => {
    // This is what leaves the recorded Tideglass run replayable: a fixture key
    // is hash(system, prompt, schema), so a schema that widened for every call
    // would rename all twenty-five of them for a field that brief never wanted.
    for (const batch of batchSlots(allocateSlots(TIDEGLASS).slots, 10)) {
      expect(fillSchemaFor(batch)).toBe(FillBatchSchema);
    }
    expect(JSON.stringify(toJsonSchema(FillBatchSchema))).not.toContain('abilities');
  });

  it('is the wider one for exactly the batches that were allocated an ability', () => {
    for (const batch of batchSlots(allocateSlots(HEARTHGLASS).slots, 10)) {
      const wants = batch.some((slot) => slot.abilityKinds.length > 0);
      expect(fillSchemaFor(batch)).toBe(wants ? FillBatchWithAbilitiesSchema : FillBatchSchema);
    }
  });

  it('offers the abilities on permanents only, and never a counter to place', () => {
    const json = JSON.stringify(toJsonSchema(FillBatchWithAbilitiesSchema));
    expect(json).toContain('abilities');
    expect(json).toContain('selfAttacks');
    expect(json).toContain('sacrificeSelf');
    // The two narrowings the model half of the vocabulary exists for.
    expect(json).not.toContain('putCounters');
    expect(json).not.toContain('distinct');
  });

  it('keeps planeswalker cards and loyalty costs outside model output', () => {
    const cards = JSON.stringify(toJsonSchema(FilledCardSchema));
    const abilities = JSON.stringify(toJsonSchema(FillBatchWithAbilitiesSchema));
    expect(cards).not.toContain('planeswalker');
    expect(abilities).not.toContain('loyaltyCost');
  });

  /**
   * A cost may sacrifice the source, and may not sacrifice anything else.
   *
   * `ModelActivationCostSchema` is `ActivationCostSchema.omit({ sacrificeOther:
   * true })`, so a Chest that eats two Keys is expressible by hand and
   * unreachable from the generator. That is deliberately the same arrangement
   * `putCounters` sits in one test above, and it is the safe direction of the
   * invariant CLAUDE.md calls load-bearing: the generator's output space stays
   * *inside* the engine's enforceable space. Containment, not equality. A cost
   * the engine can run and the generator never writes is nothing at all; a cost
   * the generator writes and the engine cannot run is a broken card.
   *
   * ## Why an omission is worth a test of its own
   *
   * `ModelAbilityIsAbility` already proves model ⊆ engine at compile time, and
   * it would go on proving it with this field restored — a wider model union is
   * still a subset of the engine's. The type says nothing about *which* fields
   * were left out, so re-adding `sacrificeOther` to the model's cost widens what
   * the generator can reach with every existing gate still green.
   *
   * Something is thrown on the way now. Zod stripped unknown keys until
   * `mtg-nhyv.69` made every object in `packages/dsl/src` a `z.strictObject`, so
   * a `sacrificeOther` the model invented used to be dropped in silence — no
   * parse error, no repair-loop violation, no log line — and is now a parse
   * error naming the key. Silence is what made a widening invisible, and it is
   * why the assertion is still written twice over.
   *
   * The two halves are different claims and a re-widening has to clear both. The
   * schema check says the model is never *shown* the field, so it is never
   * invited to spend a Key. The parse check says a cost carrying the field is
   * refused by name, so a model that emits one anyway cannot smuggle it into a
   * card — and that half holds no matter how the schema is spelled or
   * serialized, which the substring check alone cannot promise.
   */
  it('never offers a cost that sacrifices a permanent other than the source', () => {
    expect(JSON.stringify(toJsonSchema(FillBatchWithAbilitiesSchema))).not.toContain('sacrificeOther');

    const smuggled = ModelAbilitySchema.safeParse({
      kind: 'activated',
      cost: {
        mana: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0 },
        tapSelf: false,
        sacrificeSelf: true,
        sacrificeOther: { count: 2, subtype: 'Key' },
      },
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    });
    expect(smuggled.success).toBe(false);
    expect(smuggled.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('sacrificeOther'),
    );
  });
});

describe('the fill prompt for an ability batch', () => {
  const allocation = allocateSlots(HEARTHGLASS);
  const batches = batchSlots(allocation.slots, 10);
  const abilityBatch = batches.find((batch) => batch.some((slot) => slot.abilityKinds.length > 0));
  const plainBatch = batches.find((batch) => batch.every((slot) => slot.abilityKinds.length === 0));
  if (abilityBatch === undefined || plainBatch === undefined) {
    throw new Error('the Hearthglass allocation has no ability batch and no plain batch to compare it to');
  }
  const abilityPrompt = promptFor(HEARTHGLASS, abilityBatch);

  it('explains what an ability is', () => {
    expect(abilityPrompt).toContain('<ability_vocabulary>');
    for (const kind of new Set(abilityBatch.flatMap((slot) => slot.abilityKinds))) {
      expect(abilityPrompt).toContain(`- ${kind}:`);
    }
  });

  it('names the mechanic on the slot that has to print it', () => {
    for (const slot of abilityBatch.filter((item) => item.abilityKinds.length > 0)) {
      const line = abilityPrompt.split('\n').find((text) => text.startsWith('  abilities: exactly 1 entry'));
      expect(line, `${slot.id} was offered no ability budget`).toBeDefined();
      expect(line).toContain(slot.abilityKinds.join(' or '));
      for (const mechanic of slot.mechanics) expect(line).toContain(mechanic);
    }
  });

  it('says nothing about abilities to a batch that was allocated none', () => {
    const plain = promptFor(HEARTHGLASS, plainBatch);
    expect(plain).not.toContain('<ability_vocabulary>');
    expect(plain).not.toContain('  abilities:');
  });

  it('offers only keywords the color pie will accept in that pool', () => {
    const white = allocation.slots.filter(
      (slot) => slot.color === 'W' && slot.rarity === 'common' && slot.abilityKinds.includes('static'),
    );
    expect(white.length).toBeGreaterThan(0);
    const prompt = promptFor(HEARTHGLASS, white);
    const line = prompt.split('\n').find((text) => text.includes('grantKeyword'));
    if (line === undefined) throw new Error('the static vocabulary offered no grantKeyword menu');
    for (const keyword of KEYWORDS) {
      const onPie = classify(keyword, 'W').verdict !== 'fail';
      expect(line.includes(keyword), `${keyword} is ${onPie ? 'on' : 'off'}-pie in W`).toBe(onPie);
    }
  });

  it('withholds counterSpell from a batch whose only ability kind is the trigger', () => {
    const triggerOnly = allocation.slots.filter(
      (slot) => slot.abilityKinds.includes('triggered') && !slot.abilityKinds.includes('activated'),
    );
    expect(triggerOnly.length).toBeGreaterThan(0);
    const vocabulary = /<effect_vocabulary>\n([\s\S]*?)\n<\/effect_vocabulary>/.exec(
      promptFor(HEARTHGLASS, triggerOnly),
    );
    if (vocabulary?.[1] === undefined) throw new Error('the trigger batch was offered no effect vocabulary');
    expect(vocabulary[1]).not.toContain('counterSpell');
  });
});

/** A slot's worth of model output, with whatever abilities the caller wants. */
function filledCreature(slot: Slot, abilities: readonly ModelAbility[]): FilledCard {
  return {
    slotId: slot.id,
    kind: 'creature',
    name: 'Lamp Warden',
    subtypes: ['Human'],
    manaCost: { generic: slot.manaValueMin - 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
    power: 2,
    toughness: 2,
    designNote: 'A warden that keeps working after it falls.',
    abilities: [...abilities],
  };
}

describe('assembly and the set-level gates', () => {
  const allocation = allocateSlots(HEARTHGLASS);
  const slot = allocation.slots.find(
    (item) => item.color === 'W' && item.rarity === 'common' && item.abilityKinds.length > 0,
  );
  if (slot === undefined) throw new Error('no white common was allocated an ability');

  const assembled = assembleCard(
    slot,
    filledCreature(slot, [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
    ]),
    'HRT',
  );

  it('carries the ability onto a card the DSL calls enforceable', () => {
    const card = assembled.card;
    expect(assembled.violations).toStrictEqual([]);
    if (card === undefined) throw new Error('the card did not assemble');
    expect(card.abilities).toHaveLength(1);
    expect(validateCard(card)).toStrictEqual([]);
    expect(card.oracleText).toContain('When Lamp Warden dies');
  });

  it('counts the mechanic as covered at common', () => {
    const card = assembled.card;
    if (card === undefined) throw new Error('the card did not assemble');
    const vigil = HEARTHGLASS.mechanics.find((mechanic) => mechanic.name === 'Vigil');
    if (vigil === undefined) throw new Error('the brief lost its Vigil mechanic');
    expect(checkMechanicCoverage([{ slot, card }], [vigil])).toStrictEqual([]);
  });

  /**
   * The effect half of the same reading, which was dead for every permanent.
   *
   * `assemble.ts` writes `effects: []` on every generated creature and artifact,
   * because a permanent prints its effects inside its abilities. Coverage asked
   * `card.effects`, so an effect kind could only ever match a spell: this exact
   * card, whose trigger gains two life, read as a set that never prints
   * `gainLife` at common. A mechanic stated as an effect kind is the ordinary
   * case — three of Tideglass Reach's four are — and once a permanent may carry
   * an ability, the effect a mechanic is made of is printed there.
   */
  it('reads an effect kind out of the ability a permanent printed it in', () => {
    const card = assembled.card;
    if (card === undefined) throw new Error('the card did not assemble');
    expect(card.effects, 'a generated permanent has no effect list of its own').toStrictEqual([]);
    expect(
      checkMechanicCoverage([{ slot, card }], [mechanic({ effectKinds: ['gainLife'], colors: ['W'] })]),
    ).toStrictEqual([]);
  });

  it('refuses an ability kind the slot was not allocated', () => {
    const wrong = assembleCard(
      slot,
      filledCreature(slot, [
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0 },
            tapSelf: true,
            sacrificeSelf: false,
          },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ]),
      'HRT',
    ).card;
    if (wrong === undefined) throw new Error('the card did not assemble');
    expect(checkSlotConformance(slot, wrong).map((item) => item.code)).toContain('SLOT_ABILITY_NOT_ALLOWED');
  });

  it('refuses a slot reserved for the mechanic that printed no ability', () => {
    const bare = assembleCard(slot, filledCreature(slot, []), 'HRT').card;
    if (bare === undefined) throw new Error('the card did not assemble');
    expect(checkSlotConformance(slot, bare).map((item) => item.code)).toContain('SLOT_ABILITY_NOT_ALLOWED');
  });

  /**
   * Any ability-free creature slot will do, and white no longer has one.
   *
   * This asked for a white one, which was a convenience rather than a claim:
   * nothing about the check is colored. At twenty cards white gets two creature
   * slots and Hearthglass's mechanic names white, so both of them now carry an
   * ability kind and the convenience turned into a thrown error. The slot the
   * allocator reserved nothing on is the subject; which color it landed in is
   * the allocator's business.
   */
  it('refuses an ability on a slot the allocator gave none', () => {
    const plain = allocation.slots.find(
      (item) => item.cardKind === 'creature' && item.abilityKinds.length === 0,
    );
    if (plain === undefined) throw new Error('no ability-free creature slot');
    const card = assembleCard(
      plain,
      filledCreature(plain, [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 0 },
        },
      ]),
      'HRT',
    ).card;
    if (card === undefined) throw new Error('the card did not assemble');
    expect(checkSlotConformance(plain, card).map((item) => item.code)).toContain('SLOT_ABILITY_NOT_ALLOWED');
  });

  it('rules on the color pie inside an ability, not only on a spell', () => {
    // Printed on a white instant, an off-pie effect is an OFF_PIE error already;
    // the point of the check is that hiding it inside a trigger does not make it
    // legal. The kind is read off the pie rather than named, so the test says
    // what it means when a future edition moves a row.
    expect(classify('millCards', 'W').verdict).toBe('fail');
    const offPie = assembleCard(
      slot,
      filledCreature(slot, [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'millCards', count: 2, target: { kind: 'noTarget' } }],
        },
      ]),
      'HRT',
    ).card;
    if (offPie === undefined) throw new Error('the card did not assemble');
    expect(checkCardPie(slot, offPie).map((item) => item.code)).toStrictEqual(['OFF_PIE']);
  });
});

/**
 * The mechanic printed on a token rather than on the card that mints it.
 *
 * Fuse is the flagship set's first mechanic and `FuseAbilitySchema` is a
 * *token* ability, so `putCounters` is printed nowhere a walk of the card's own
 * two lists can reach. The brief states it, `checkMechanicsPrinted` has always
 * walked tokens to find it, and coverage did not: the one word that says Fuse is
 * Fuse could not put Fuse at common, and the mechanic passed on the bare word
 * "triggered" instead.
 */
describe('coverage over a mechanic printed on a token', () => {
  const commonSlot: Slot = {
    id: 'CB01',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'B',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: ['triggered'],
    auraModifications: [],
    triggerConditions: ['selfDies'],
    mechanics: ['Fuse'],
    archetypes: [],
    signpost: false,
  };

  /** A small body that leaves a part behind, and the part fuses onto a creature. */
  const dropsAPart = parseCard({
    id: 'hrt-lamp-warden',
    name: 'Lamp Warden',
    kind: 'creature',
    rarity: 'common',
    set: { code: 'HRT', collectorNumber: 4 },
    colors: ['B'],
    manaCost: { generic: 1, B: 1 },
    power: 2,
    toughness: 1,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: 'Watchlight',
              colors: [],
              subtypes: ['Part'],
              keywords: [],
              abilities: [
                {
                  kind: 'activated',
                  cost: { mana: { generic: 1 }, sacrificeSelf: true },
                  effects: [
                    {
                      kind: 'putCounters',
                      counter: 'plusOnePlusOne',
                      count: 1,
                      target: { kind: 'targetCreatureYouControl' },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  });

  it('finds the counter the part places, which is printed on no card', () => {
    expect(dropsAPart.effects).toStrictEqual([]);
    expect(
      checkMechanicCoverage(
        [{ slot: commonSlot, card: dropsAPart }],
        [mechanic({ effectKinds: ['putCounters'] })],
      ),
    ).toStrictEqual([]);
  });

  it('still reports a mechanic the set prints nowhere', () => {
    expect(
      checkMechanicCoverage(
        [{ slot: commonSlot, card: dropsAPart }],
        [mechanic({ effectKinds: ['millCards'] })],
      ).map((item) => item.code),
    ).toStrictEqual(['MECHANIC_ABSENT_AT_COMMON']);
  });
});

describe('the New World Order gate', () => {
  it('counts a wide token whichever line of the card made it', () => {
    const base = {
      id: 'hrt-lamp-warden',
      name: 'Lamp Warden',
      kind: 'creature' as const,
      rarity: 'common' as const,
      set: { code: 'HRT', collectorNumber: 1 },
      manaCost: { generic: 2, W: 1, U: 0, B: 0, R: 0, G: 0, hasX: false },
      artifact: false,
      colors: ['W'] as const,
      supertypes: [],
      subtypes: [],
      keywords: [],
      effects: [],
      power: 2,
      toughness: 2,
    };
    const token = { name: 'Watchlight', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] };
    const card: Card = {
      ...base,
      colors: ['W'],
      costReduction: null,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'createToken', count: 2, token }],
        },
      ],
    };
    expect(redFlagsFor(card)).toContain('wideBoard');
    expect(redFlagsFor({ ...card, abilities: [] })).not.toContain('wideBoard');
  });

  /**
   * The drop economy has to survive the rule that was written for it.
   *
   * Decisions 6 and 8 of the set design document put "when this
   * dies, create a Key" on small Monsters, and a mechanic that is not at common
   * is not the theme. So a trigger costing a flag is only the right rule if a
   * small Monster with one keyword and one death trigger still spends one flag
   * and stays common. Two flags is an `NWO_MULTI_RED_FLAG` error that moves the
   * card to uncommon and the mechanic with it.
   */
  const monster = (abilities: Card['abilities'], keywords: Card['keywords']): Card => ({
    id: 'hrt-brigand-scout',
    name: 'Brigand Scout',
    kind: 'creature',
    rarity: 'common',
    set: { code: 'HRT', collectorNumber: 2 },
    manaCost: { generic: 1, W: 0, U: 0, B: 1, R: 0, G: 0, hasX: false },
    artifact: false,
    colors: ['B'],
    supertypes: [],
    subtypes: ['Brigand', 'Monster'],
    keywords,
    effects: [],
    abilities,
    costReduction: null,
    power: 2,
    toughness: 1,
  });

  const dropsAKey: Card['abilities'] = [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: { name: 'Key', colors: [], subtypes: ['Key'], keywords: [] },
        },
      ],
    },
  ];

  const commonSlot: Slot = {
    id: 'CB03',
    index: 2,
    collectorNumber: 3,
    rarity: 'common',
    color: 'B',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: ['triggered'],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };

  it('spends one flag on a trigger, and a keyword beside it does not spend a second', () => {
    expect(redFlagsFor(monster(dropsAKey, []))).toStrictEqual(['trackedAbility']);
    expect(redFlagsFor(monster(dropsAKey, ['menace']))).toStrictEqual(['trackedAbility']);
  });

  it('leaves the monster-drop common at common', () => {
    const result = checkNewWorldOrder([{ slot: commonSlot, card: monster(dropsAKey, ['menace']) }], 1);
    expect(result.findings).toStrictEqual([]);
    expect(result.flagged).toStrictEqual([{ slotId: 'CB03', rules: ['trackedAbility'] }]);
  });

  it('does not spend a flag on a static, which is read once and never again', () => {
    const alwaysBigger: Card['abilities'] = [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
    ];
    expect(redFlagsFor(monster(alwaysBigger, ['menace']))).toStrictEqual([]);
  });

  it('spends one flag however many tracked abilities are printed', () => {
    const both: Card['abilities'] = [
      ...dropsAKey,
      {
        kind: 'activated',
        cost: {
          mana: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false },
          tapSelf: true,
          sacrificeSelf: false,
        },
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ];
    expect(redFlagsFor(monster(both, []))).toStrictEqual(['trackedAbility']);
  });
});

/**
 * The colorless pool, asked for an ability.
 *
 * Every brief in this tree until now put its ability mechanics in colors, so
 * `color === null` was a branch nothing entered: four mutations to it left the
 * suite green (inverting `appliesToPool`'s colorless test either way, making
 * `grantableKeywords(null)` return every keyword, and deleting the
 * `COLORLESS_ALLOWED_EFFECTS` filter). A brief whose mechanic names no colors
 * is what enters it, and the flagship set's first mechanic is exactly that
 * shape - a part token is a colorless artifact, so "any color" has to mean the
 * colorless pool too.
 *
 * Ninety cards rather than the twenty `TEST_BRIEF` states: a twenty-card
 * skeleton splits evenly across five colors and leaves the colorless pool with
 * nothing in it, so there would be no slot to reserve.
 */
describe('a mechanic that names no colors reaches the colorless pool', () => {
  const briefWith = (kinds: readonly AbilityKind[], colors: readonly Color[]): SetBrief =>
    parseBrief({
      ...TEST_BRIEF,
      targetSize: 90,
      mechanics: [
        {
          name: 'Fuse',
          description: 'A part is spent, not worn: the artifact pays itself away and the creature keeps it.',
          abilityKinds: [...kinds],
          colors: [...colors],
        },
      ],
    });

  const abilitySlotsIn = (brief: SetBrief, pool: Color | null): Slot[] =>
    allocateSlots(brief).slots.filter((slot) => slot.color === pool && slot.abilityKinds.length > 0);

  const promptForPool = (kinds: readonly AbilityKind[], pool: Color | null): string => {
    const brief = briefWith(kinds, pool === null ? [] : [pool]);
    const slot = abilitySlotsIn(brief, pool)[0];
    if (slot === undefined) throw new Error(`no ${pool ?? 'colorless'} slot carried the mechanic`);
    return promptFor(brief, [slot]);
  };

  const effectVocabulary = (prompt: string): string | undefined =>
    /<effect_vocabulary>\n([\s\S]*?)\n<\/effect_vocabulary>/.exec(prompt)?.[1];

  it('reserves a colorless slot for it, and reserves none for a mechanic that names colors', () => {
    expect(abilitySlotsIn(briefWith(['triggered'], []), null).length).toBeGreaterThan(0);
    expect(abilitySlotsIn(briefWith(['triggered'], ['W']), null)).toStrictEqual([]);
  });

  /**
   * A colorless static may change the source's own power and toughness and
   * nothing else. The pie is a color table with no row for a colorless card, so
   * `COLORLESS_ALLOWED_EFFECTS` is the whole allowance and no keyword is in it;
   * offering one would be offering a design `checkCardPie` rejects. A white
   * static, built the same way, is told which keywords it may grant.
   */
  it('offers a colorless static its stat bonus and no keyword to grant', () => {
    const prompt = promptForPool(['static'], null);
    expect(prompt).toContain('"kind":"statBonus"');
    expect(prompt).not.toContain('grantKeyword');
    expect(promptForPool(['static'], 'W')).toContain('grantKeyword');
  });

  /**
   * The bug this was written for. `abilityEffectKinds(null, ['triggered'])`
   * returned exactly `['destroyPermanent']`, whose only legal target is
   * `targetCreature`, and `checkTriggeredEffectTarget` refused any triggered
   * effect that was not `noTarget`. The whole menu was unprintable, and the
   * generator would have spent a regeneration round finding that out.
   *
   * That validator was deleted in `10c72ed`: a trigger chooses its targets now,
   * and the card the old menu could not print validates clean. What this pins
   * is therefore today's `choosesNothing`, not today's engine — the filter
   * outlived its reason, `prompts.ts` says so on the function, and widening it
   * is a design change that re-keys every fixture holding a trigger-only slot.
   */
  it('offers a colorless trigger only effects it could legally print', () => {
    const vocabulary = effectVocabulary(promptForPool(['triggered'], null));
    expect(vocabulary, 'the trigger was offered no effects at all').toBeDefined();
    expect(vocabulary).toContain('createToken');
    for (const kind of ['destroyPermanent', 'tapPermanent', 'returnToHand', 'counterSpell']) {
      expect(vocabulary, `${kind} cannot use noTarget and must not be offered`).not.toContain(kind);
    }
  });

  /**
   * An activation chooses its targets when it is activated, so the target rule
   * narrows nothing here and the colorless allowance is the only thing left
   * doing the work. Drop the `COLORLESS_ALLOWED_EFFECTS` filter and this fails.
   */
  it('keeps a colorless activation inside the colorless allowance', () => {
    const vocabulary = effectVocabulary(promptForPool(['activated'], null));
    expect(vocabulary).toContain('destroyPermanent');
    for (const kind of ['dealDamage', 'drawCards', 'gainLife', 'millCards']) {
      expect(vocabulary, `${kind} is outside the colorless allowance`).not.toContain(kind);
    }
  });
});
