/** Hand-authored creature tokens may carry the card CDA the kernel already runs. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  ModelTokenSpecSchema,
  printedPowerToughness,
  renderEffect,
  renderTokenOracleText,
  safeParseCard,
  tokenCard,
  TokenSpecSchema,
  validateCard,
} from '@mtg/dsl';

const AVATAR = {
  identity: 'avatar-life-total',
  name: 'Avatar',
  power: 0,
  toughness: 0,
  characteristicPowerToughness: { kind: 'controllerLifeTotal' },
  colors: ['W'],
  subtypes: ['Avatar'],
  keywords: [],
} as const;

function maker(token: unknown): CardInput {
  return {
    kind: 'sorcery',
    id: 'm11-ajani-avatar-maker',
    name: 'Ajani Avatar Maker',
    rarity: 'mythic',
    set: { code: 'M11', collectorNumber: 1 },
    manaCost: { generic: 2, W: 2 },
    colors: ['W'],
    effects: [{ kind: 'createToken', count: 1, token }],
  } as CardInput;
}

describe('a characteristic-defining creature token', () => {
  it('becomes the same CDA-bearing creature card as an ordinary card', () => {
    const spec = TokenSpecSchema.parse(AVATAR);
    const card = tokenCard(spec);
    expect(card.kind).toBe('creature');
    if (card.kind !== 'creature') throw new Error('Avatar token was not a creature');
    expect(card.characteristicPowerToughness).toEqual({ kind: 'controllerLifeTotal' });
    expect(printedPowerToughness(card)).toBe('*/*');
    expect(renderTokenOracleText(spec)).toBe(
      "This creature's power and toughness are each equal to your life total.",
    );
  });

  it('prints Ajani’s quoted token text without fabricating fixed stats', () => {
    const spec = TokenSpecSchema.parse(AVATAR);
    expect(renderEffect({ kind: 'createToken', count: 1, token: spec }, 'Ajani Goldmane')).toBe(
      'Create a white Avatar creature token. It has "This token\'s power and toughness are each equal to your life total."',
    );
  });

  it('keeps supported keywords and abilities beside the characteristic definition', () => {
    const spec = TokenSpecSchema.parse({
      ...AVATAR,
      keywords: ['flying'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(validateCard(maker(spec))).toStrictEqual([]);
    expect(renderTokenOracleText(spec)).toBe(
      "Flying This creature's power and toughness are each equal to your life total. When Avatar dies, you gain 1 life.",
    );
    expect(renderEffect({ kind: 'createToken', count: 1, token: spec }, 'Ajani Goldmane')).toBe(
      'Create a white Avatar creature token named Avatar with flying. It has "This token\'s power and toughness are each equal to your life total."',
    );

    const quoted = TokenSpecSchema.parse({ ...spec, quoteAbilities: true });
    expect(renderEffect({ kind: 'createToken', count: 1, token: quoted }, 'Ajani Goldmane')).toBe(
      'Create a white Avatar creature token. It has "Flying This token\'s power and toughness are each equal to your life total. When this token dies, you gain 1 life."',
    );
  });

  it('requires the canonical 0/0 storage sentinel for the CDA', () => {
    const parsed = safeParseCard(maker({ ...AVATAR, power: 1, toughness: 1 }));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.violations.map((violation) => violation.code)).toContain(
      'CHARACTERISTIC_POWER_TOUGHNESS_CONFLICT',
    );
  });

  it('does not widen the model token schema', () => {
    expect(Object.keys(ModelTokenSpecSchema.shape)).toEqual([
      'name',
      'power',
      'toughness',
      'colors',
      'subtypes',
      'keywords',
    ]);
    expect(ModelTokenSpecSchema.safeParse(AVATAR).success).toBe(false);
  });
});
