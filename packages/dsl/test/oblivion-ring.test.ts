/** Oblivion Ring's exact source-scoped linked-exile contract. */
import { describe, expect, it } from 'vitest';
import {
  ModelEffectSchema,
  ModelTargetSpecSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '@mtg/dsl';

const WRITER = {
  kind: 'exileTarget',
  target: {
    kind: 'targetPermanent',
    filter: { excludeCardTypes: ['land'] },
    excludeSource: true,
  },
  linkToSource: true,
} as const;

const READER = { kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner' } as const;

function oblivionRing(abilities: CardInput['abilities'] = undefined): CardInput {
  return {
    kind: 'enchantment',
    id: 'm13-22-oblivion-ring',
    name: 'Oblivion Ring',
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 22 },
    manaCost: { generic: 2, W: 1 },
    colors: ['W'],
    abilities: abilities ?? [
      { kind: 'triggered', condition: 'selfEnters', effects: [WRITER] },
      { kind: 'triggered', condition: 'selfLeavesBattlefield', effects: [READER] },
    ],
  } as CardInput;
}

describe('Oblivion Ring authoring', () => {
  it('parses and renders the exact two linked triggers', () => {
    expect(renderOracleText(parseCard(oblivionRing()))).toBe(
      'When Oblivion Ring enters the battlefield, exile another target nonland permanent.\n' +
        "When Oblivion Ring leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
    );
  });

  it('keeps source exclusion and linking outside model output', () => {
    expect(ModelTargetSpecSchema.safeParse(WRITER.target).success).toBe(false);
    expect(ModelEffectSchema.safeParse(WRITER).success).toBe(false);
    expect(ModelEffectSchema.safeParse(READER).success).toBe(false);
  });

  it('refuses an unpaired linked writer or reader', () => {
    for (const ability of oblivionRing().abilities ?? []) {
      const parsed = safeParseCard(oblivionRing([ability]));
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.violations.map((entry) => entry.code)).toContain('SOURCE_LINKED_EXILE_INVALID');
    }
  });

  it('refuses source exclusion outside the reviewed linked-exile shape', () => {
    const parsed = safeParseCard(
      oblivionRing([
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'destroyPermanent',
              target: { kind: 'targetPermanent', excludeSource: true },
            },
          ],
        },
      ]),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => entry.code)).toContain('SOURCE_LINKED_EXILE_INVALID');
  });
});
