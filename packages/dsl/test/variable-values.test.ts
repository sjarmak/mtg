/** Engine-only X and characteristic values without widening model output. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FillBatchSchema } from '@mtg/setgen';
import type { CardInput } from '../src/index';
import {
  canonicalJson,
  formatManaCost,
  mana,
  ManaCostSchema,
  manaValue,
  ModelManaCostSchema,
  renderCard,
  renderOracleText,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function digest(schema: z.ZodType): string {
  return createHash('sha256')
    .update(canonicalJson(z.toJSONSchema(schema, { io: 'output' })))
    .digest('hex');
}

function card(patch: Partial<CardInput>): CardInput {
  return {
    kind: 'instant',
    id: 'tst-variable-value',
    name: 'Variable Value',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { R: 2, hasX: true },
    colors: ['R'],
    effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
    ...patch,
  } as CardInput;
}

describe('X mana and chosen-X amounts', () => {
  it('parses one bounded marker, prints X first, and treats X as zero outside the stack', () => {
    const cost = mana({ generic: 3, R: 2, hasX: true });
    expect(cost).toEqual({ generic: 3, W: 0, U: 0, B: 0, R: 2, G: 0, hasX: true });
    expect(formatManaCost(cost)).toBe('{X}{3}{R}{R}');
    expect(manaValue(cost)).toBe(5);
    // `mana()` is a raw builder for hand-authored TS (already type-checked at
    // the call site); the runtime validation boundary for hostile input is
    // `ManaCostSchema`, applied to every card through `CardSchema` at parse
    // time (`card.ts`). That is where an out-of-domain `hasX` is rejected.
    expect(() => ManaCostSchema.parse({ R: 1, hasX: 2 as never })).toThrow();
  });

  it('allows chosenX only where something announced a value: a spell or an activation', () => {
    expect(validateCard(card({}))).toEqual([]);
    const fixed = card({ manaCost: { R: 2 } });
    expect(validateCard(fixed).map((found) => found.code)).toContain('CHOSEN_X_WITHOUT_X_COST');

    // A trigger announces nothing at all — it goes on the stack because the
    // game put it there, and CR 601.2b never runs — so there is no value for a
    // chosen-X amount to read no matter what the card's own mana cost says.
    const triggered = card({
      kind: 'creature',
      effects: [],
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    expect(validateCard(triggered).map((found) => found.code)).toContain('CHOSEN_X_WITHOUT_X_COST');

    // An activation does announce one (CR 602.2b routes it through the same
    // CR 601.2 steps a cast uses), so the amount reads the ability's own cost
    // rather than the card's — a fixed-cost creature with an {X} activation is
    // the legal shape, and it is Silklash Spider's.
    const activated = card({
      kind: 'creature',
      manaCost: { generic: 4, G: 2 },
      colors: ['G'],
      effects: [],
      power: 2,
      toughness: 5,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { G: 2, hasX: true } },
          effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    expect(validateCard(activated)).toEqual([]);
  });

  it('prints one X in an activation cost and the same X in the effect it pays for', () => {
    // Scope item 3 of `mtg-nhyv.17`, and the whole reason the oracle line is
    // load-bearing: `manaValue` counts X as nothing, so an activation cost of
    // exactly `{X}` used to render as an empty cost clause and a card whose
    // ability appeared free. The cost clause and the effect sentence have to
    // agree on the letter, because a reader has no other way to learn that the
    // number they announce is the number the ability deals.
    const spider = parseCard(
      card({
        kind: 'creature',
        id: 'tst-flame-archer',
        name: 'Flame Archer',
        set: { code: 'TST', collectorNumber: 2 },
        manaCost: { generic: 3, R: 1 },
        colors: ['R'],
        effects: [],
        power: 2,
        toughness: 3,
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { R: 1, hasX: true }, tapSelf: true },
            effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
          },
        ],
      }),
    );
    expect(renderOracleText(spider)).toBe('{X}{R}, {T}: Flame Archer deals X damage to any target.');
  });

  it('renders the exact Volcanic Geyser value sentence', () => {
    const geyser = parseCard(
      card({
        id: 'm13-volcanic-geyser',
        name: 'Volcanic Geyser',
        set: { code: 'M13', collectorNumber: 154 },
      }),
    );
    expect(renderOracleText(geyser)).toBe('Volcanic Geyser deals X damage to any target.');
    expect(renderCard(geyser).split('\n')[0]).toBe('Volcanic Geyser {X}{R}{R}');
  });
});

describe('characteristic-defining power and toughness', () => {
  it('renders Crusader of Odric as */* with its exact typed rules text', () => {
    const crusader = parseCard(
      card({
        kind: 'creature',
        id: 'm13-crusader-of-odric',
        name: 'Crusader of Odric',
        set: { code: 'M13', collectorNumber: 10 },
        manaCost: { generic: 2, W: 1 },
        colors: ['W'],
        effects: [],
        power: 0,
        toughness: 0,
        characteristicPowerToughness: { kind: 'creaturesYouControl' },
      }),
    );
    expect(renderOracleText(crusader)).toBe(
      "Crusader of Odric's power and toughness are each equal to the number of creatures you control.",
    );
    expect(renderCard(crusader).split('\n').at(-1)).toBe('*/*');
  });

  it('rejects ambiguous fixed stats and characteristic values on noncreatures', () => {
    const conflicting = card({
      kind: 'creature',
      power: 2,
      toughness: 2,
      characteristicPowerToughness: { kind: 'creaturesYouControl' },
      effects: [],
    });
    expect(validateCard(conflicting).map((found) => found.code)).toContain(
      'CHARACTERISTIC_POWER_TOUGHNESS_CONFLICT',
    );
    expect(
      validateCard(
        card({ characteristicPowerToughness: { kind: 'controllerLifeTotal' } } as Partial<CardInput>),
      ).map((found) => found.code),
    ).toContain('CREATURE_STATS_ON_NONCREATURE');
  });
});

describe('generator containment', () => {
  it('keeps the model mana and full fill schemas byte-identical', () => {
    expect(digest(ModelManaCostSchema)).toBe(
      '1fe727a509658a0f25e9a1b3fbe98185d09697f2aac2f4c43c9a943af2929c76',
    );
    expect(digest(FillBatchSchema)).toBe('7515a524f01ce8388d0a22477611fe27daa302351fd7c25e69edf14dc55d1d11');
    const shown = canonicalJson(z.toJSONSchema(FillBatchSchema, { io: 'output' }));
    expect(shown).not.toContain('chosenX');
    expect(shown).not.toContain('characteristicPowerToughness');
  });
});
