/**
 * `sacrificeSelf` as an *effect*, and `beginningOfEndStep` as the trigger
 * condition that reaches it (`mtg-nhyv.30`).
 *
 * ## Three things are spelled `sacrificeSelf` and only one of them is this
 *
 *   1. `ActivationCost.sacrificeSelf` (`ability-shape.ts`) — a boolean on an
 *      activated ability's cost. Prints *before* the colon, as
 *      `Sacrifice <card name>`, and is paid on activation (CR 601.2h).
 *   2. `FuseAbilitySchema`'s pinned `sacrificeSelf: z.literal(true)`
 *      (`effects.ts`) — the same cost field, narrowed to `true` for the one
 *      ability shape that must always carry it.
 *   3. This one: a member of the effect union, printed *after* the colon (or
 *      after the trigger's comma) as a sentence, and applied on resolution.
 *
 * A reader who conflates them will break the cost path, so the two forms are
 * put side by side below on purpose: `Sacrifice Bomb Bag:` is the cost, and
 * `sacrifice this creature.` is the effect, in the same file.
 *
 * ## Why the effect carries a target
 *
 * `renderEffect` is not handed the card's kind, and the printed line names a
 * noun: "sacrifice this creature". `selfCreature` already carries that noun as
 * a retained referent (CR 115.6a, not targeting), so the effect names it and
 * `who()` prints the right word with no new plumbing. It buys the spell
 * refusal for free too: `checkEffectTarget` refuses a source-body kind on an
 * instant, because a spell on the stack has no body to sacrifice.
 *
 * `selfPermanent` is the kind it does *not* admit, and the last test here is
 * why: one behavior with two spellings is the ambiguity
 * `self-permanent-target.test.ts` exists to keep out of the vocabulary.
 *
 * The kernel half — CR 701.17, and that a sacrifice is not a destruction — is
 * `packages/kernel/test/sacrifice-self.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  EFFECT_KINDS,
  HAND_AUTHORED_TARGETS,
  LEGAL_TARGETS,
  MODEL_TRIGGER_CONDITIONS,
  ModelEffectSchema,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  UNPRICED_EFFECT_KINDS,
  legalTargetsFor,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';
import { parseCard } from '../src/parse';

const CONDITION: TriggerCondition = 'beginningOfEndStep';

/**
 * Arc Runner (M11 123): `{2}{R}` 5/1 Elemental Ox with haste, whose whole
 * second line is the trigger and the effect this file is about.
 */
function arcRunnerInput(): CardInput {
  return {
    kind: 'creature',
    id: 'ref-arc-runner',
    name: 'Arc Runner',
    rarity: 'common',
    set: { code: 'REF', collectorNumber: 123 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: ['Elemental', 'Ox'],
    keywords: ['haste'],
    power: 5,
    toughness: 1,
    abilities: [
      {
        kind: 'triggered',
        condition: CONDITION,
        effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
      },
    ],
  } as CardInput;
}

/** `{1}, Sacrifice Bomb Bag: Bomb Bag deals 2 damage to any target.` — the *cost* spelling. */
function bombBagInput(): CardInput {
  return {
    kind: 'artifact',
    id: 'ref-bomb-bag',
    name: 'Bomb Bag',
    rarity: 'common',
    set: { code: 'REF', collectorNumber: 125 },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, sacrificeSelf: true },
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      },
    ],
  } as CardInput;
}

describe('beginningOfEndStep', () => {
  it('is its own condition beside the controller-filtered one, not a rename of it', () => {
    expect(TRIGGER_CONDITIONS).toContain(CONDITION);
    expect(TRIGGER_CONDITIONS).toContain('beginningOfYourEndStep');
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(CONDITION);
  });

  it('prints "the" rather than "your", which is the whole difference', () => {
    expect(TRIGGER_PRINT_TEMPLATES[CONDITION]).toBe('At the beginning of the end step,');
    expect(TRIGGER_PRINT_TEMPLATES.beginningOfYourEndStep).toBe('At the beginning of your end step,');
  });
});

describe('the sacrificeSelf effect', () => {
  it('is unpriced: no slot may ask a model for it and no color pie prices it', () => {
    expect(ALL_EFFECT_KINDS).toContain('sacrificeSelf');
    expect([...UNPRICED_EFFECT_KINDS]).toContain('sacrificeSelf');
    expect([...EFFECT_KINDS]).not.toContain('sacrificeSelf');
  });

  it("is on a card's union and off the model's", () => {
    const effect = { kind: 'sacrificeSelf', target: { kind: 'selfCreature' } };
    expect(CardEffectSchema.safeParse(effect).success).toBe(true);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('names the source and nothing else, so no card can aim it at a neighbor', () => {
    expect(LEGAL_TARGETS.sacrificeSelf).toEqual([]);
    expect(HAND_AUTHORED_TARGETS['sacrificeSelf']).toEqual(['selfCreature']);
    expect(legalTargetsFor('sacrificeSelf')).toEqual(['selfCreature']);
  });

  it('prints Arc Runner, whole', () => {
    const card = parseCard(arcRunnerInput());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Haste\nAt the beginning of the end step, sacrifice this creature.');
  });

  it('refuses the permanent-shaped referent, so one behavior has one spelling', () => {
    const result = safeParseCard({
      kind: 'artifact',
      id: 'ref-fading-reliquary',
      name: 'Fading Reliquary',
      rarity: 'common',
      set: { code: 'REF', collectorNumber: 124 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'triggered',
          condition: CONDITION,
          effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // `ILLEGAL_TARGET_IN_ABILITY` rather than `ILLEGAL_TARGET_FOR_EFFECT`: the
    // ability path reads `legalTargetsFor` itself and reports under its own
    // code, and this effect only ever appears inside an ability.
    expect(result.violations.map((found) => found.code)).toContain('ILLEGAL_TARGET_IN_ABILITY');
    expect(result.violations.map((found) => found.message).join(' ')).toContain(
      'sacrificeSelf cannot use "selfPermanent"',
    );
  });

  it('is refused on a spell, which has no body on the battlefield to sacrifice', () => {
    const result = safeParseCard({
      kind: 'instant',
      id: 'ref-sacrifice-bolt',
      name: 'Reliquary Bolt',
      rarity: 'common',
      set: { code: 'REF', collectorNumber: 126 },
      manaCost: { generic: 1, R: 1 },
      colors: ['R'],
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });
});

describe('the effect and the activation cost that share its name', () => {
  it('print on opposite sides of the colon and are not the same field', () => {
    const cost = parseCard(bombBagInput());
    expect(validateCard(cost)).toEqual([]);
    expect(renderOracleText(cost)).toBe('{1}, Sacrifice Bomb Bag: Bomb Bag deals 2 damage to any target.');
    const paid = cost.abilities[0];
    expect(paid?.kind).toBe('activated');
    if (paid?.kind !== 'activated') return;
    expect(paid.cost.sacrificeSelf).toBe(true);
    expect(paid.effects.map((effect) => effect.kind)).toEqual(['dealDamage']);

    const printed = parseCard(arcRunnerInput()).abilities[0];
    expect(printed?.kind).toBe('triggered');
    if (printed?.kind !== 'triggered') return;
    expect(printed.effects.map((effect) => effect.kind)).toEqual(['sacrificeSelf']);
  });
});
