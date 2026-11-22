/**
 * Generator-facing schemas admit only literal amounts (#303).
 *
 * A generated set cannot grow an army of thousands of tokens from one
 * count-based effect, and the only thing that makes that true is that every
 * model vocabulary builds `generatableEffects` over `z.int()` where the
 * engine's own unions pass `AmountSchema`. `deckbuild/src/token-count.ts`
 * leans on the same fact in prose. The trigger half of that growth shape is
 * pinned in `model-capability-bundles.test.ts`; this file pins the amount half.
 *
 * The check is structural rather than one parse per field: it walks every
 * schema a model answer can reach and fails on any member whose `kind` is a
 * computed-amount kind, so a count kind added to `ComputedAmountSchema` later
 * is covered without editing this file. The engine's own unions are walked as
 * the control, so a walker that stopped seeing anything would fail here too.
 */
import { describe, expect, it } from 'vitest';
import {
  AttachingMechanicModelAbilitySchema,
  AttachingModelAbilitySchema,
  CardEffectSchema,
  ComputedAmountSchema,
  ControlledCreatureCounterOnEntryModelAbilitySchema,
  EffectSchema,
  FightOpposingCreatureModelEffectSchema,
  KeywordGrantToControlledCreatureModelEffectSchema,
  LoyaltyModelAbilitySchema,
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  ModelAuraSchema,
  ModelEffectSchema,
  OwnGraveyardCardToHandModelEffectSchema,
  PartBearingModelEffectSchema,
  RatePerSchema,
  ReturnArtifactOrEnchantmentToHandModelEffectSchema,
  SharedComputedAmountSchema,
  UntapControlledCreatureModelEffectSchema,
  ZoneReachingModelEffectSchema,
} from '../src/index';

/** The slice of Zod 4's internal definition this walk reads. */
interface SchemaDef {
  readonly type: string;
  readonly shape?: Record<string, unknown>;
  readonly options?: readonly unknown[];
  readonly element?: unknown;
  readonly innerType?: unknown;
  readonly in?: unknown;
  readonly out?: unknown;
  readonly getter?: () => unknown;
  readonly items?: readonly unknown[];
  readonly rest?: unknown;
  readonly left?: unknown;
  readonly right?: unknown;
  readonly keyType?: unknown;
  readonly valueType?: unknown;
  readonly values?: readonly unknown[];
}

function defOf(schema: unknown): SchemaDef {
  const zod = (schema as { _zod?: { def?: SchemaDef } })._zod;
  if (zod?.def === undefined) throw new Error('expected a Zod 4 schema');
  return zod.def;
}

function children(def: SchemaDef): readonly (readonly [string, unknown])[] {
  switch (def.type) {
    case 'object':
      return Object.entries(def.shape ?? {});
    case 'union':
      return (def.options ?? []).map((option) => ['|', option] as const);
    case 'array':
      return [['[]', def.element]];
    case 'tuple':
      return [
        ...(def.items ?? []).map((item, i) => [`[${i}]`, item] as const),
        ...(def.rest ? [['[...]', def.rest] as const] : []),
      ];
    case 'pipe':
      return [
        ['', def.in],
        ['', def.out],
      ];
    case 'lazy':
      return def.getter === undefined ? [] : [['', def.getter()]];
    case 'intersection':
      return [
        ['&', def.left],
        ['&', def.right],
      ];
    case 'record':
      return [
        ['{key}', def.keyType],
        ['{value}', def.valueType],
      ];
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return [['', def.innerType]];
    default:
      return [];
  }
}

/** The literal a strict object carries at `kind`, when it carries one. */
function kindLiterals(def: SchemaDef): readonly unknown[] {
  if (def.type !== 'object' || def.shape?.['kind'] === undefined) return [];
  const kind = defOf(def.shape['kind']);
  return kind.type === 'literal' ? (kind.values ?? []) : [];
}

/** Top-level member kinds of an amount union: its options, not their filters. */
function memberKinds(schema: unknown): readonly unknown[] {
  const def = defOf(schema);
  if (def.type === 'union') return (def.options ?? []).flatMap(memberKinds);
  return kindLiterals(def);
}

const COMPUTED_KINDS = new Set([
  ...memberKinds(ComputedAmountSchema),
  ...memberKinds(SharedComputedAmountSchema),
  ...memberKinds(RatePerSchema),
]);

/** Every path under `schema` that admits a computed (non-literal) amount. */
function computedAmountSlots(schema: unknown): readonly string[] {
  const found: string[] = [];
  // Ancestors only, so a recursive schema terminates while a shared one (the
  // same amount union under every effect) is still reported at each path.
  const ancestors = new Set<unknown>();
  const visit = (node: unknown, path: string): void => {
    if (ancestors.has(node)) return;
    const def = defOf(node);
    const kinds = kindLiterals(def);
    if (kinds.some((kind) => COMPUTED_KINDS.has(kind))) {
      found.push(`${path} (${kinds.join(', ')})`);
      return;
    }
    ancestors.add(node);
    const step = kinds.length > 0 ? `${path}<${kinds.join(',')}>` : path;
    for (const [key, child] of children(def))
      visit(child, key === '' || key === '|' ? step : `${step}.${key}`);
    ancestors.delete(node);
  };
  visit(schema, '');
  return found;
}

const GENERATOR_SCHEMAS = {
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  ZoneReachingModelEffectSchema,
  KeywordGrantToControlledCreatureModelEffectSchema,
  FightOpposingCreatureModelEffectSchema,
  UntapControlledCreatureModelEffectSchema,
  ReturnArtifactOrEnchantmentToHandModelEffectSchema,
  OwnGraveyardCardToHandModelEffectSchema,
  ModelAbilitySchema,
  ControlledCreatureCounterOnEntryModelAbilitySchema,
  AttachingModelAbilitySchema,
  MechanicModelAbilitySchema,
  AttachingMechanicModelAbilitySchema,
  LoyaltyModelAbilitySchema,
  ModelAuraSchema,
} as const;

describe('generator schemas refuse computed amounts', () => {
  it('reads the computed-amount vocabulary it guards against', () => {
    expect(COMPUTED_KINDS).toContain('countMatching');
    expect(COMPUTED_KINDS).toContain('ratePer');
    // An effect sharing a name with a computed amount would be flagged as one.
    const effectKinds = new Set(memberKinds(CardEffectSchema));
    expect([...COMPUTED_KINDS].filter((kind) => effectKinds.has(kind))).toEqual([]);
  });

  it('finds the computed slots the engine itself prints (control)', () => {
    expect(computedAmountSlots(EffectSchema).some((slot) => slot.startsWith('<createToken>.count '))).toBe(
      true,
    );
    expect(
      computedAmountSlots(CardEffectSchema).some((slot) => slot.startsWith('<createToken>.count ')),
    ).toBe(true);
  });

  for (const [name, schema] of Object.entries(GENERATOR_SCHEMAS)) {
    it(`${name} admits only literal amounts`, () => {
      expect(
        computedAmountSlots(schema),
        `${name} now accepts a computed amount. A count-based token or amount in a generated card can grow without bound, so widening it needs a growth review (#303), the way the reviewed capability schemas need one.`,
      ).toEqual([]);
    });
  }

  it('refuses a token count read off the board', () => {
    const token = { name: 'Test Wisp', power: 1, toughness: 1 };
    const literal = { kind: 'createToken', count: 2, token };
    const counted = { ...literal, count: { kind: 'countMatching', filter: { cardTypes: ['creature'] } } };
    expect(ModelEffectSchema.safeParse(literal).success).toBe(true);
    expect(EffectSchema.safeParse(counted).success).toBe(true);
    expect(ModelEffectSchema.safeParse(counted).success).toBe(false);
  });
});
