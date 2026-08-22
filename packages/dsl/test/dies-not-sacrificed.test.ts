/**
 * The death condition a sacrifice does not satisfy.
 *
 * `TRIGGER_CONDITIONS` gained `selfDiesNotSacrificed` for a design ruling
 * rather than for a rules gap: a creature that leaves a body behind when it
 * dies must not become a sacrifice outlet's engine, and CR 700.4's "dies" is
 * the zone change and says nothing about the cause, so `selfDies` cannot print
 * the restriction. CR 701.17b is the rule the narrower condition reads.
 *
 * Two properties are worth a file, and neither is about the kernel — the
 * kernel's half is `packages/kernel/test/death-not-sacrificed.test.ts`. The
 * first is the freeze: `MODEL_TRIGGER_CONDITIONS` is still the three it held
 * before, in order, so the JSON Schema every fill batch is shown is
 * byte-identical and every recorded fixture still replays. The second is that
 * the printed sentence says the restriction — a card whose text promised
 * "when this dies" while the engine refused half of those deaths would be the
 * divergence this vocabulary exists to prevent, pointing the wrong way.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const NOT_SACRIFICED: TriggerCondition = 'selfDiesNotSacrificed';

/**
 * No `abilities` key, and that is the model tier's rule rather than a
 * shortening: `ModelTokenSpecSchema` declares no such field, so an empty list
 * here would make the control below fail on the token rather than on the
 * condition it is controlling for (`mtg-nhyv.69`).
 */
const REVENANT = {
  name: 'Revenant',
  power: 5,
  toughness: 5,
  colors: ['B'],
  subtypes: ['Spirit'],
  keywords: [],
};

const DEATH_TRIGGER = {
  kind: 'triggered',
  condition: NOT_SACRIFICED,
  effects: [{ kind: 'createToken', count: 1, token: REVENANT }],
};

function creatureInput(): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-not-sacrificed-probe',
    name: 'Clutching Dread',
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 4 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    subtypes: ['Horror'],
    supertypes: [],
    keywords: [],
    abilities: [DEATH_TRIGGER],
    power: 3,
    toughness: 3,
  };
}

describe('the death condition a sacrifice does not satisfy', () => {
  /**
   * Two sentences rather than one pinned tuple, for the reason
   * `controller-target.test.ts` states: a pinned tuple would report every
   * future widening as a break of a property that is only about the three the
   * generator is shown and their order.
   */
  it('leaves the conditions the generator chooses from where they were, in order', () => {
    expect([...MODEL_TRIGGER_CONDITIONS]).toEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    expect([...TRIGGER_CONDITIONS].slice(0, MODEL_TRIGGER_CONDITIONS.length)).toEqual([
      ...MODEL_TRIGGER_CONDITIONS,
    ]);
  });

  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(NOT_SACRIFICED);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(NOT_SACRIFICED);
  });

  /**
   * Containment at the schema, which is where it bites: the ability is an
   * `Ability` and is not a `ModelAbility`, exactly as `putCounters` is an
   * `Effect` and is not a `ModelEffect` (`model-abilities.test.ts`).
   */
  it('is expressible by hand and unreachable from the generator', () => {
    expect(AbilitySchema.safeParse(DEATH_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(DEATH_TRIGGER).success).toBe(false);
    // The same ability under the wider condition is reachable, so the refusal
    // above is about this member and not about the shape around it.
    expect(ModelAbilitySchema.safeParse({ ...DEATH_TRIGGER, condition: 'selfDies' }).success).toBe(true);
  });

  it('prints the restriction rather than the bare death', () => {
    const card = parseCard(creatureInput() as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      "When Clutching Dread dies, if it wasn't sacrificed, create a 5/5 black Spirit creature token.",
    );
  });

  /** Every condition prints something, which is what makes the table total. */
  it('carries a printed template of its own', () => {
    expect(TRIGGER_PRINT_TEMPLATES[NOT_SACRIFICED]).toBe("When {name} dies, if it wasn't sacrificed,");
    expect(TRIGGER_PRINT_TEMPLATES[NOT_SACRIFICED]).not.toBe(TRIGGER_PRINT_TEMPLATES.selfDies);
  });
});
