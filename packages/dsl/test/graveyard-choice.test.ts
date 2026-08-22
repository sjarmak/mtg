/**
 * `chooseFromGraveyard`: the single-card half of graveyard recursion, kept out
 * of the generator and printed as the choice it is.
 *
 * `returnFromGraveyard` is the mass form and reaches a graveyard through an
 * `EffectScope`, so every card it can print raises a whole class at once. The
 * seven M11/M13 identities that recur one card — Disentomb, Call to Mind,
 * Archaeomancer, Nature's Spiral, Revive, Gravedigger, Vile Rebirth — say *one*
 * card and leave the choosing to a player, and neither half of that is reachable
 * by narrowing a scope. These assertions pin the three things that were easy to
 * get wrong: the destination set, the colors field that Revive alone needed, and
 * an oracle line that says "a card" rather than "target card", because the
 * kernel asks a mid-resolution question and does not target.
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

const DISENTOMB = {
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
        const effect = { ...DISENTOMB, whose, destination };
        expect(CardEffectSchema.parse(effect)).toEqual(effect);
      }
    }
  });

  it('refuses a destination no printed card names', () => {
    expect(CardEffectSchema.safeParse({ ...DISENTOMB, destination: 'library' }).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...DISENTOMB, destination: 'graveyard' }).success).toBe(false);
  });

  it('takes an empty filter, which is a real card and not a degenerate case', () => {
    const anything = { ...DISENTOMB, filter: {} };
    expect(CardEffectSchema.parse(anything)).toEqual(anything);
  });

  it('filters on printed color, which is the field Revive needed', () => {
    const revive = { ...DISENTOMB, filter: { colors: ['G'] } };
    expect(CardEffectSchema.parse(revive)).toEqual(revive);
    expect(CardEffectSchema.safeParse({ ...DISENTOMB, filter: { colors: ['Q'] } }).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...DISENTOMB, filter: { colors: [] } }).success).toBe(false);
  });

  it('stays out of every model-facing union', () => {
    expect(ModelEffectSchema.safeParse(DISENTOMB).success).toBe(false);
    expect(ZoneReachingModelEffectSchema.safeParse(DISENTOMB).success).toBe(false);
  });
});

function sorceryText(effect: unknown, name = 'Disentomb'): string {
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
  it('prints Disentomb without the word "target"', () => {
    expect(sorceryText(DISENTOMB)).toBe('Return a creature card from your graveyard to your hand.');
  });

  it('prints Revive off the color filter alone', () => {
    expect(sorceryText({ ...DISENTOMB, filter: { colors: ['G'] } }, 'Revive')).toBe(
      'Return a green card from your graveyard to your hand.',
    );
  });

  it('prints Call to Mind with both card types joined by "or"', () => {
    expect(sorceryText({ ...DISENTOMB, filter: { cardTypes: ['instant', 'sorcery'] } }, 'Call to Mind')).toBe(
      'Return an instant or sorcery card from your graveyard to your hand.',
    );
  });

  it('prints Vile Rebirth reaching either graveyard', () => {
    expect(sorceryText({ ...DISENTOMB, whose: 'each', destination: 'exile' }, 'Vile Rebirth')).toBe(
      'Exile a creature card from a graveyard.',
    );
  });

  it("says whose the reanimated permanent is, because it is its owner's", () => {
    expect(sorceryText({ ...DISENTOMB, whose: 'each', destination: 'battlefield' }, 'Raise')).toBe(
      "Return a creature card from a graveyard to the battlefield under its owner's control.",
    );
    expect(sorceryText({ ...DISENTOMB, destination: 'battlefield' }, 'Raise')).toBe(
      'Return a creature card from your graveyard to the battlefield under your control.',
    );
  });

  it("names an opponent's graveyard without targeting it", () => {
    expect(sorceryText({ ...DISENTOMB, whose: 'opponent', destination: 'exile' }, 'Rob')).toBe(
      "Exile a creature card from an opponent's graveyard.",
    );
  });
});

const RISE_FROM_THE_GRAVE = {
  kind: 'chooseFromGraveyard',
  whose: 'each',
  filter: { cardTypes: ['creature'] },
  destination: 'battlefield',
  control: 'you',
  alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
} as const;

function sorceryWith(effect: unknown, name = 'Rise from the Grave') {
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
  it('takes the control clause and the arrival grant Rise from the Grave prints', () => {
    expect(GRAVEYARD_CHOICE_CONTROLLERS).toEqual(['owner', 'you']);
    expect(CardEffectSchema.parse(RISE_FROM_THE_GRAVE)).toEqual(RISE_FROM_THE_GRAVE);
  });

  it('leaves both fields optional, so every card written before them still parses', () => {
    expect(CardEffectSchema.parse(DISENTOMB)).toEqual(DISENTOMB);
    expect(CardEffectSchema.parse(DISENTOMB)).not.toHaveProperty('control');
    expect(CardEffectSchema.parse(DISENTOMB)).not.toHaveProperty('alsoBecomes');
  });

  it('prints the whole card, in addition rather than instead', () => {
    expect(renderOracleText(parseCard(sorceryWith(RISE_FROM_THE_GRAVE)))).toBe(
      'Return a creature card from a graveyard to the battlefield under your control.' +
        ' That creature is a black Zombie in addition to its other colors and types.',
    );
  });

  it('prints a color-only grant and a type-only grant in their own words', () => {
    const colorOnly = { ...RISE_FROM_THE_GRAVE, alsoBecomes: { colors: ['B', 'R'] } };
    expect(renderOracleText(parseCard(sorceryWith(colorOnly)))).toBe(
      'Return a creature card from a graveyard to the battlefield under your control.' +
        ' That creature is black and red in addition to its other colors.',
    );
    const typeOnly = { ...RISE_FROM_THE_GRAVE, alsoBecomes: { subtypes: ['Zombie'] } };
    expect(renderOracleText(parseCard(sorceryWith(typeOnly)))).toBe(
      'Return a creature card from a graveyard to the battlefield under your control.' +
        ' That creature is a Zombie in addition to its other types.',
    );
  });

  it("still says under its owner's control when the effect does not claim it", () => {
    const owned = { ...RISE_FROM_THE_GRAVE, control: 'owner', alsoBecomes: { subtypes: ['Zombie'] } };
    expect(renderOracleText(parseCard(sorceryWith(owned)))).toBe(
      "Return a creature card from a graveyard to the battlefield under its owner's control." +
        ' That creature is a Zombie in addition to its other types.',
    );
  });

  it('refuses a control clause or a grant on a destination that is not the battlefield', () => {
    const toHand = { ...RISE_FROM_THE_GRAVE, destination: 'hand' };
    const codes = validateCard(sorceryWith(toHand)).map((found) => found.code);
    expect(codes.filter((code) => code === 'EFFECT_PARAM_OUT_OF_RANGE')).toHaveLength(2);
    const paths = validateCard(sorceryWith(toHand)).map((found) => found.path);
    expect(paths).toContain('effects[0].control');
    expect(paths).toContain('effects[0].alsoBecomes');
  });

  it('refuses a grant that grants nothing', () => {
    const empty = { ...RISE_FROM_THE_GRAVE, alsoBecomes: {} };
    expect(validateCard(sorceryWith(empty)).map((found) => found.code)).toContain(
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
  });

  it('refuses a subtype that is not one', () => {
    const lowercase = { ...RISE_FROM_THE_GRAVE, alsoBecomes: { subtypes: ['zombie'] } };
    expect(validateCard(sorceryWith(lowercase)).map((found) => found.code)).toContain('INVALID_SUBTYPE');
  });

  it('passes clean on the card it was written for', () => {
    expect(validateCard(sorceryWith(RISE_FROM_THE_GRAVE))).toEqual([]);
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
