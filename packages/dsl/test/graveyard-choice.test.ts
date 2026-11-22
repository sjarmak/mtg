/**
 * `chooseFromGraveyard`: a genuine non-targeted, resolution-time graveyard
 * choice, kept out of the generator and printed as the choice it is.
 *
 * Printed "target card" recursion uses graveyard-card targets on
 * `returnFromGraveyard`, `returnToHand`, or `exileTarget`; this effect must not
 * stand in for those cards. These assertions pin the destination set, the
 * printed-color filter, and an Oracle line that says "a card" rather than
 * "target card", because this primitive really does ask a mid-resolution
 * question.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CardEffectSchema,
  GRAVEYARD_CHOICE_CONTROLLERS,
  GRAVEYARD_CHOICE_DESTINATIONS,
  ModelEffectSchema,
  parseCard,
  PartBearingModelEffectSchema,
  renderOracleText,
  validateCard,
  ZoneReachingModelEffectSchema,
} from '@mtg/dsl';

const NON_TARGETED_RECALL = {
  kind: 'chooseFromGraveyard',
  whose: 'you',
  filter: { cardTypes: ['creature'] },
  destination: 'hand',
} as const;

describe('chooseFromGraveyard schema', () => {
  it('accepts each printed destination and each graveyard owner', () => {
    expect(GRAVEYARD_CHOICE_DESTINATIONS).toEqual(['hand', 'battlefield', 'exile']);
    for (const destination of GRAVEYARD_CHOICE_DESTINATIONS) {
      for (const whose of ['you', 'opponent', 'each'] as const) {
        const effect = { ...NON_TARGETED_RECALL, whose, destination };
        expect(CardEffectSchema.parse(effect)).toEqual(effect);
      }
    }
  });

  it('refuses a destination no printed card names', () => {
    expect(CardEffectSchema.safeParse({ ...NON_TARGETED_RECALL, destination: 'library' }).success).toBe(
      false,
    );
    expect(CardEffectSchema.safeParse({ ...NON_TARGETED_RECALL, destination: 'graveyard' }).success).toBe(
      false,
    );
  });

  it('takes an empty filter, which is a real card and not a degenerate case', () => {
    const anything = { ...NON_TARGETED_RECALL, filter: {} };
    expect(CardEffectSchema.parse(anything)).toEqual(anything);
  });

  it('filters a non-targeted choice on printed color', () => {
    const greenChoice = { ...NON_TARGETED_RECALL, filter: { colors: ['G'] } };
    expect(CardEffectSchema.parse(greenChoice)).toEqual(greenChoice);
    expect(CardEffectSchema.safeParse({ ...NON_TARGETED_RECALL, filter: { colors: ['Q'] } }).success).toBe(
      false,
    );
    expect(CardEffectSchema.safeParse({ ...NON_TARGETED_RECALL, filter: { colors: [] } }).success).toBe(
      false,
    );
  });

  it('stays out of every model-facing union', () => {
    expect(ModelEffectSchema.safeParse(NON_TARGETED_RECALL).success).toBe(false);
    expect(ZoneReachingModelEffectSchema.safeParse(NON_TARGETED_RECALL).success).toBe(false);
  });
});

function sorceryText(effect: unknown, name = 'Grave Recall'): string {
  return renderOracleText(
    parseCard({
      kind: 'sorcery',
      id: 'test-graveyard-choice',
      name,
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 94 },
      manaCost: { B: 1 },
      colors: ['B'],
      effects: [effect],
    }),
  );
}

describe('chooseFromGraveyard oracle text', () => {
  it('prints a genuine choice without the word "target"', () => {
    expect(sorceryText(NON_TARGETED_RECALL)).toBe('Return a creature card from your graveyard to your hand.');
  });

  it('prints a color-only filter', () => {
    expect(sorceryText({ ...NON_TARGETED_RECALL, filter: { colors: ['G'] } }, 'Green Recall')).toBe(
      'Return a green card from your graveyard to your hand.',
    );
  });

  it('prints multiple card types joined by "or"', () => {
    expect(
      sorceryText({ ...NON_TARGETED_RECALL, filter: { cardTypes: ['instant', 'sorcery'] } }, 'Spell Recall'),
    ).toBe('Return an instant or sorcery card from your graveyard to your hand.');
  });

  it('prints a choice reaching either graveyard', () => {
    expect(sorceryText({ ...NON_TARGETED_RECALL, whose: 'each', destination: 'exile' }, 'Grave Feast')).toBe(
      'Exile a creature card from a graveyard.',
    );
  });

  it("says whose the reanimated permanent is, because it is its owner's", () => {
    expect(sorceryText({ ...NON_TARGETED_RECALL, whose: 'each', destination: 'battlefield' }, 'Raise')).toBe(
      "Return a creature card from a graveyard to the battlefield under its owner's control.",
    );
    expect(sorceryText({ ...NON_TARGETED_RECALL, destination: 'battlefield' }, 'Raise')).toBe(
      'Return a creature card from your graveyard to the battlefield under your control.',
    );
  });

  it("names an opponent's graveyard without targeting it", () => {
    expect(sorceryText({ ...NON_TARGETED_RECALL, whose: 'opponent', destination: 'exile' }, 'Rob')).toBe(
      "Exile a creature card from an opponent's graveyard.",
    );
  });
});

const NON_TARGETED_REANIMATION = {
  kind: 'chooseFromGraveyard',
  whose: 'each',
  filter: { cardTypes: ['creature'] },
  destination: 'battlefield',
  control: 'you',
  alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
} as const;

function sorceryWith(effect: unknown, name = 'Grave Conscript') {
  return {
    kind: 'sorcery',
    id: 'test-graveyard-grant',
    name,
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 95 },
    manaCost: { generic: 4, B: 1 },
    colors: ['B'],
    effects: [effect],
  };
}

describe("chooseFromGraveyard under the chooser's control", () => {
  it('takes a control clause and arrival grant for a non-targeted choice', () => {
    expect(GRAVEYARD_CHOICE_CONTROLLERS).toEqual(['owner', 'you']);
    expect(CardEffectSchema.parse(NON_TARGETED_REANIMATION)).toEqual(NON_TARGETED_REANIMATION);
  });

  it('leaves both fields optional, so every card written before them still parses', () => {
    expect(CardEffectSchema.parse(NON_TARGETED_RECALL)).toEqual(NON_TARGETED_RECALL);
    expect(CardEffectSchema.parse(NON_TARGETED_RECALL)).not.toHaveProperty('control');
    expect(CardEffectSchema.parse(NON_TARGETED_RECALL)).not.toHaveProperty('alsoBecomes');
  });

  it('prints the whole card, in addition rather than instead', () => {
    expect(renderOracleText(parseCard(sorceryWith(NON_TARGETED_REANIMATION)))).toBe(
      'Return a creature card from a graveyard to the battlefield under your control.' +
        ' That creature is a black Zombie in addition to its other colors and types.',
    );
  });

  it('prints a color-only grant and a type-only grant in their own words', () => {
    const colorOnly = { ...NON_TARGETED_REANIMATION, alsoBecomes: { colors: ['B', 'R'] } };
    expect(renderOracleText(parseCard(sorceryWith(colorOnly)))).toBe(
      'Return a creature card from a graveyard to the battlefield under your control.' +
        ' That creature is black and red in addition to its other colors.',
    );
    const typeOnly = { ...NON_TARGETED_REANIMATION, alsoBecomes: { subtypes: ['Zombie'] } };
    expect(renderOracleText(parseCard(sorceryWith(typeOnly)))).toBe(
      'Return a creature card from a graveyard to the battlefield under your control.' +
        ' That creature is a Zombie in addition to its other types.',
    );
  });

  it("still says under its owner's control when the effect does not claim it", () => {
    const owned = { ...NON_TARGETED_REANIMATION, control: 'owner', alsoBecomes: { subtypes: ['Zombie'] } };
    expect(renderOracleText(parseCard(sorceryWith(owned)))).toBe(
      "Return a creature card from a graveyard to the battlefield under its owner's control." +
        ' That creature is a Zombie in addition to its other types.',
    );
  });

  it('refuses a control clause or a grant on a destination that is not the battlefield', () => {
    const toHand = { ...NON_TARGETED_REANIMATION, destination: 'hand' };
    const codes = validateCard(sorceryWith(toHand)).map((found) => found.code);
    expect(codes.filter((code) => code === 'EFFECT_PARAM_OUT_OF_RANGE')).toHaveLength(2);
    const paths = validateCard(sorceryWith(toHand)).map((found) => found.path);
    expect(paths).toContain('effects[0].control');
    expect(paths).toContain('effects[0].alsoBecomes');
  });

  it('refuses a grant that grants nothing', () => {
    const empty = { ...NON_TARGETED_REANIMATION, alsoBecomes: {} };
    expect(validateCard(sorceryWith(empty)).map((found) => found.code)).toContain(
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
  });

  it('refuses a subtype that is not one', () => {
    const lowercase = { ...NON_TARGETED_REANIMATION, alsoBecomes: { subtypes: ['zombie'] } };
    expect(validateCard(sorceryWith(lowercase)).map((found) => found.code)).toContain('INVALID_SUBTYPE');
  });

  it('passes clean on the card it was written for', () => {
    expect(validateCard(sorceryWith(NON_TARGETED_REANIMATION))).toEqual([]);
  });

  /**
   * The fixture-key freeze, `conjunctive-card-type.test.ts`'s pattern and its
   * reason: every recorded generator call is keyed by
   * `sha256(system, prompt, schema)`, so a field that reached the model-facing
   * JSON Schema would strand all of them behind a paid re-record. This whole
   * effect kind is off the model's vocabulary already, which is what makes the
   * assertion cheap to keep true and worth checking anyway.
   */
  it('is unreachable from every schema the generator is shown', () => {
    for (const schema of [
      ModelEffectSchema,
      PartBearingModelEffectSchema,
      ZoneReachingModelEffectSchema,
    ] as const) {
      const json = JSON.stringify(z.toJSONSchema(schema as unknown as z.ZodType, { io: 'input' }));
      expect(json).not.toContain('alsoBecomes');
      expect(json).not.toContain('chooseFromGraveyard');
    }
  });
});
