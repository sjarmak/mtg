/**
 * The ability shape the set generator is allowed to answer with.
 *
 * `ModelAbilitySchema` is the third application of `abilitiesOver`, and the one
 * with a consumer outside this package: `@mtg/setgen` puts its JSON Schema in
 * front of the model. The claim it has to keep is the project's load-bearing
 * invariant in miniature — everything the generator can propose is something
 * the engine can run — so these tests check the containment in both directions
 * rather than checking that the schema parses.
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_KINDS,
  AbilitySchema,
  MODEL_ABILITY_KINDS,
  ModelAbilitySchema,
  isModelAbilityKind,
} from '../src/index';
import type { Ability, ModelAbilityIsAbility } from '../src/index';

/**
 * The compile-time half. This assignment is the test: if `ModelAbility` stops
 * being assignable to `Ability`, the alias resolves to `never` and this file
 * fails `npm run typecheck` before vitest ever loads it.
 */
const modelAbilitiesAreEngineAbilities: ModelAbilityIsAbility = true;

describe('ModelAbilitySchema', () => {
  it('is a subset of the engine ability union at the type level', () => {
    expect(modelAbilitiesAreEngineAbilities).toBe(true);
  });

  it('reads its kinds off its own schema, so the list cannot drift', () => {
    expect(MODEL_ABILITY_KINDS).toStrictEqual(ModelAbilitySchema.options.map((o) => o.shape.kind.value));
    for (const kind of MODEL_ABILITY_KINDS) expect(ABILITY_KINDS).toContain(kind);
    for (const kind of ABILITY_KINDS) expect(isModelAbilityKind(kind)).toBe(true);
  });

  it('accepts each of the three kinds, and the engine accepts what it accepted', () => {
    const proposed = [
      { kind: 'static', scope: 'self', modification: { kind: 'statBonus', power: 1, toughness: 1 } },
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, sacrificeSelf: true },
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      },
    ];

    for (const input of proposed) {
      const model = ModelAbilitySchema.parse(input);
      // Not "the engine schema also accepts the input": the engine has to accept
      // the *parsed* value, because that is the object `assembleCard` hands on.
      const engine: Ability = AbilitySchema.parse(model);
      expect(engine.kind).toBe(model.kind);
    }
  });

  it('refuses the effects the model may not print, and the engine still takes them', () => {
    const placesCounter = {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    };

    // Strictly a subset: the engine runs this ability and the generator cannot
    // reach it, which is `effects.ts`'s decision about `putCounters` arriving
    // here for free rather than being restated.
    expect(ModelAbilitySchema.safeParse(placesCounter).success).toBe(false);
    expect(AbilitySchema.safeParse(placesCounter).success).toBe(true);
  });

  it('refuses the targeting field the fill prompt has not taught', () => {
    const distinct = {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } }],
    };

    // The narrowing is what the model is *shown*; a refusal naming the key is
    // what it gets if it writes the field anyway (`mtg-nhyv.69`). Nothing that
    // reaches `CardSchema` carries a constraint the prompt never explained, and
    // the failure is a retry rather than a card that silently targets
    // differently. The engine's own schema keeps the field.
    const model = ModelAbilitySchema.safeParse(distinct);
    expect(model.success).toBe(false);
    expect(model.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"distinct"'),
    );
    expect(model.error?.issues.map((issue) => issue.path.join('.'))).toContainEqual('effects.0.target');
    expect(JSON.stringify(AbilitySchema.parse(distinct))).toContain('distinct');
  });

  it('narrows a token spec the same way, so no ability can smuggle one back', () => {
    const withTokenAbilities = {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Bramble Sprout',
            power: 1,
            toughness: 1,
            abilities: [
              { kind: 'static', scope: 'self', modification: { kind: 'grantKeyword', keyword: 'flying' } },
            ],
          },
        },
      ],
    };

    // Refused at the token spec rather than at the ability, so the retry tells
    // the model which nested key it may not write; the engine still mints the
    // flier from the same input.
    const model = ModelAbilitySchema.safeParse(withTokenAbilities);
    expect(model.success).toBe(false);
    expect(model.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"abilities"'),
    );
    expect(model.error?.issues.map((issue) => issue.path.join('.'))).toContainEqual('effects.0.token');
    expect(JSON.stringify(AbilitySchema.parse(withTokenAbilities))).toContain('flying');
  });

  it('parses a model ability into a value assignable to the engine type', () => {
    const model = ModelAbilitySchema.parse({
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    });
    // Narrowed by the guard rather than annotated `ModelAbility`, so the
    // assignment below exercises exactly the branch this case parses:
    // `activated` is the one member where `ModelAbility` and `Ability`
    // disagree (`ModelAbilityIsAbility`'s docblock in `abilities.ts` argues
    // why — `cost.mana.hasX`), and a `triggered` ability carries no cost for
    // that disagreement to reach.
    if (model.kind !== 'triggered') throw new Error('expected a triggered ability');
    const engine: Ability = model;
    expect(engine).toStrictEqual(model);
  });

  /**
   * CR 611.2c's `enabledWhile` is the engine union's alone. A fixture key is
   * `hash(system, prompt, schema)`, so this is the same fixture-safety claim
   * `amount.test.ts` pins on bytes for `ModelEffectSchema`, checked here on the
   * field a model-facing static could otherwise gain silently.
   */
  it('offers the model no `enabledWhile`, on a static or anywhere else', () => {
    const staticAbility = ModelAbilitySchema.parse({
      kind: 'static',
      scope: 'self',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    });
    expect('enabledWhile' in staticAbility).toBe(false);
    expect(JSON.stringify(staticAbility)).not.toContain('enabledWhile');

    const withField = {
      ...staticAbility,
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 },
    };
    // The generator cannot reach it even if a model writes the key anyway: the
    // schema refuses the ability and names the field, the same guarantee
    // `refuses the targeting field` proves above.
    const reparsed = ModelAbilitySchema.safeParse(withField);
    expect(reparsed.success).toBe(false);
    expect(reparsed.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"enabledWhile"'),
    );
  });
});
