/**
 * What a brief may commission, and where the widening stops.
 *
 * The file was written when an enchantment was an engine-only card and the
 * generator's card kinds were four. `mtg-fv5s` moved that line rather than
 * erasing it: the generator builds enchantments and planeswalkers now, and
 * `land` is still a kind no brief can ask for.
 *
 * The five tiers that predate the widening refusing both new kinds is the other
 * half, and it is not a leftover assertion. A fixture key is a hash of
 * (system, prompt, schema), so a batch that asks for none of this has to be
 * shown the schema it was always shown; a new member reaching an old tier would
 * strand every recorded run behind a live re-record. The three new tiers accept
 * what they were added for, and are checked here beside the five that must not.
 */
import { describe, expect, it } from 'vitest';
import type { Card, ModelAbility, ModelAbilityIsAbility } from '@mtg/dsl';
import {
  FilledCardSchema,
  FilledCardWithAbilitiesAndSpellPermanentsSchema,
  FilledCardWithAbilitiesSchema,
  FilledCardWithEquipAndMechanicsSchema,
  FilledCardWithEquipSchema,
  FilledCardWithMechanicsAndSpellPermanentsSchema,
  FilledCardWithMechanicsSchema,
  FilledCardWithSpellPermanentsSchema,
  RequiredCardSchema,
} from '@mtg/setgen';

const modelAbilitiesRemainInsideEngineAbilities: ModelAbilityIsAbility = true;

/** Every tier that existed before the generator could print a spell permanent. */
const OLDER_TIERS = [
  FilledCardSchema,
  FilledCardWithAbilitiesSchema,
  FilledCardWithEquipSchema,
  FilledCardWithMechanicsSchema,
  FilledCardWithEquipAndMechanicsSchema,
] as const;

/** The three that were added to hold one. */
const SPELL_PERMANENT_TIERS = [
  FilledCardWithSpellPermanentsSchema,
  FilledCardWithAbilitiesAndSpellPermanentsSchema,
  FilledCardWithMechanicsAndSpellPermanentsSchema,
] as const;

/** True when the union has no member for this kind at all. */
function refusesKind(
  schema: (typeof OLDER_TIERS)[number] | (typeof SPELL_PERMANENT_TIERS)[number],
  kind: string,
): boolean {
  const result = schema.safeParse({ kind });
  if (result.success) return false;
  return result.error.issues.some((issue) => issue.path.length === 1 && issue.path[0] === 'kind');
}

describe('generator containment', () => {
  it('keeps every model ability assignable to the engine while briefs expose exactly the generated kinds', () => {
    expect(modelAbilitiesRemainInsideEngineAbilities).toBe(true);
    const acceptsAbility = (_ability: ModelAbility): void => undefined;
    expect(acceptsAbility).toBeTypeOf('function');
    for (const cardKind of ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker']) {
      expect(RequiredCardSchema.safeParse({ name: 'Generated Card', cardKind }).success, cardKind).toBe(true);
    }
    expect(RequiredCardSchema.safeParse({ name: 'Engine-Only Card', cardKind: 'land' }).success).toBe(false);
  });

  it('excludes land from every fill union there is', () => {
    for (const schema of [...OLDER_TIERS, ...SPELL_PERMANENT_TIERS]) {
      expect(refusesKind(schema, 'land')).toBe(true);
    }
  });

  it('leaves the five older tiers exactly as narrow as they were', () => {
    for (const schema of OLDER_TIERS) {
      for (const kind of ['enchantment', 'planeswalker']) {
        expect(refusesKind(schema, kind), kind).toBe(true);
      }
    }
  });

  it('gives the three new tiers a member for each kind they were added for', () => {
    for (const schema of SPELL_PERMANENT_TIERS) {
      for (const kind of ['enchantment', 'planeswalker']) {
        // The empty card still fails - it names no slot, no cost and no design
        // note - but it fails on those fields rather than on the discriminator,
        // which is the difference between "this union holds no such card" and
        // "this card is incomplete".
        expect(refusesKind(schema, kind), kind).toBe(false);
      }
    }
  });

  it('does not mistake generator exclusion for engine exclusion', () => {
    const engineCard: Card = {
      kind: 'enchantment',
      id: 'hand-authored-aura',
      name: 'Hand Authored Aura',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0, hasX: false },
      costReduction: null,
      colors: ['W'],
      supertypes: [],
      subtypes: ['Aura'],
      keywords: [],
      effects: [],
      abilities: [],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'cantAttack' }, { kind: 'grantLandwalk', landType: 'Forest' }],
      },
    };
    expect(engineCard.kind).toBe('enchantment');
    expect(engineCard.aura?.modifications).toContainEqual({
      kind: 'grantLandwalk',
      landType: 'Forest',
    });
  });
});
