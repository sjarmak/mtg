/**
 * One watch over two events: "Whenever this enters or attacks".
 *
 * `mtg-nhyv.4`. The M11 Titan cycle prints its trigger as a disjunction —
 * Grave Titan makes two Zombies on the way in and two more every attack, off
 * one printed sentence — and the vocabulary had no way to say it. Writing it as
 * two abilities is a different card: two printed sentences, two `abilityTriggered`
 * events on the arrival, and two rows wherever a card's abilities are counted.
 * So it is one condition, `selfEntersOrAttacks`, answered by `conditionsFrom`
 * from two arms (CR 603.6e for the arrival, CR 508.1 for the attack) and matched
 * once per event. The kernel's half of that claim is
 * `packages/kernel/test/triggered-abilities.test.ts`.
 *
 * Two properties belong here, and they are the two `dies-not-sacrificed.test.ts`
 * names one condition over. The first is the freeze: `MODEL_TRIGGER_CONDITIONS`
 * is still the three it held before, in order, and the widened condition reaches
 * none of the four schemas a fill batch is shown, so every recorded fixture key
 * still replays. The second is that the printed sentence says both halves — a
 * card whose text promised only the arrival while the engine also fired it on
 * the attack is the divergence this vocabulary exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
import {
  AttachingMechanicModelAbilitySchema,
  AttachingModelAbilitySchema,
  MechanicModelAbilitySchema,
} from '../src/abilities';
import { parseCard } from '../src/parse';

const ENTERS_OR_ATTACKS: TriggerCondition = 'selfEntersOrAttacks';

/**
 * No `abilities` key, for the reason `dies-not-sacrificed.test.ts` states over
 * its own token: `ModelTokenSpecSchema` declares no such field, so an empty
 * list here would make the control below fail on the token rather than on the
 * condition it is controlling for (`mtg-nhyv.69`).
 */
const ZOMBIE = {
  name: 'Zombie',
  power: 2,
  toughness: 2,
  colors: ['B'],
  subtypes: ['Zombie'],
  keywords: [],
};

const DISJUNCTIVE_TRIGGER = {
  kind: 'triggered',
  condition: ENTERS_OR_ATTACKS,
  effects: [{ kind: 'createToken', count: 2, token: ZOMBIE }],
};

function creatureInput(): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-enters-or-attacks-probe',
    name: 'Barrow Colossus',
    rarity: 'mythic',
    set: { code: 'XMP', collectorNumber: 5 },
    manaCost: { generic: 4, B: 2 },
    colors: ['B'],
    subtypes: ['Giant'],
    supertypes: [],
    keywords: [],
    abilities: [DISJUNCTIVE_TRIGGER],
    power: 6,
    toughness: 6,
  };
}

describe('a trigger that watches an arrival or an attack', () => {
  it('leaves the conditions the generator chooses from where they were, in order', () => {
    expect([...MODEL_TRIGGER_CONDITIONS]).toEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    expect([...TRIGGER_CONDITIONS].slice(0, MODEL_TRIGGER_CONDITIONS.length)).toEqual([
      ...MODEL_TRIGGER_CONDITIONS,
    ]);
  });

  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(ENTERS_OR_ATTACKS);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(ENTERS_OR_ATTACKS);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    expect(AbilitySchema.safeParse(DISJUNCTIVE_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(DISJUNCTIVE_TRIGGER).success).toBe(false);
    // The same ability under a condition the model holds is reachable, so the
    // refusal above is about this member and not about the shape around it.
    expect(ModelAbilitySchema.safeParse({ ...DISJUNCTIVE_TRIGGER, condition: 'selfEnters' }).success).toBe(
      true,
    );
  });

  /**
   * The fixture-key freeze, asserted the way `conjunctive-card-type.test.ts`
   * asserts it: every recorded generator call is keyed by
   * `sha256(system, prompt, schema)`, so a condition reaching any model-facing
   * JSON Schema would strand all of them and force a paid re-record. Four
   * schemas rather than one, because a fixture key is per prompt shape and the
   * attaching and mechanic variants are separate keys.
   */
  it('reaches none of the four ability schemas the generator is shown', () => {
    for (const schema of [
      ModelAbilitySchema,
      AttachingModelAbilitySchema,
      MechanicModelAbilitySchema,
      AttachingMechanicModelAbilitySchema,
    ] as const) {
      const json = JSON.stringify(z.toJSONSchema(schema as unknown as z.ZodType, { io: 'input' }));
      expect(json).not.toContain(ENTERS_OR_ATTACKS);
      // The narrow conditions are there, so the absence above is a fact about
      // this member rather than about a schema with no conditions in it.
      expect(json).toContain('selfEnters');
    }
  });

  it('prints both halves in one sentence', () => {
    const card = parseCard(creatureInput() as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      'Whenever Barrow Colossus enters or attacks, create two 2/2 black Zombie creature tokens.',
    );
  });

  /** Every condition prints something, which is what makes the table total. */
  it('carries a printed template of its own', () => {
    expect(TRIGGER_PRINT_TEMPLATES[ENTERS_OR_ATTACKS]).toBe('Whenever {name} enters or attacks,');
    expect(TRIGGER_PRINT_TEMPLATES[ENTERS_OR_ATTACKS]).not.toBe(TRIGGER_PRINT_TEMPLATES.selfEnters);
    expect(TRIGGER_PRINT_TEMPLATES[ENTERS_OR_ATTACKS]).not.toBe(TRIGGER_PRINT_TEMPLATES.selfAttacks);
  });
});
