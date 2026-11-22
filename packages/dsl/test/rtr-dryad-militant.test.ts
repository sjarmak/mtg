/** Dryad Militant's typed graveyard-entry replacement stays exact and contained. */
import {
  AbilitySchema,
  ModelAbilitySchema,
  hybridManaReminderText,
  parseCard,
  renderOracleText,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const REPLACE_SPELL_CARD_MOVES = {
  kind: 'staticPlayerRule' as const,
  players: 'eachPlayer' as const,
  rule: 'instantOrSorceryCardsToGraveyardAreExiled' as const,
};

const DRYAD_MILITANT = {
  kind: 'creature' as const,
  id: 'rtr-214-dryad-militant',
  name: 'Dryad Militant',
  rarity: 'uncommon' as const,
  set: { code: 'RTR', collectorNumber: 214 },
  manaCost: { hybrid: { 'G/W': 1 } },
  printedHybridManaReminder: true as const,
  colors: ['G', 'W'] as const,
  subtypes: ['Dryad', 'Soldier'],
  power: 2,
  toughness: 1,
  abilities: [REPLACE_SPELL_CARD_MOVES],
};

describe('Dryad Militant authoring', () => {
  it('parses and renders current Oracle text exactly', () => {
    expect(AbilitySchema.safeParse(REPLACE_SPELL_CARD_MOVES).success).toBe(true);
    const card = parseCard(DRYAD_MILITANT);
    if (card.kind === 'land' || card.kind === 'battle') throw new Error('Dryad Militant lost its cost');
    expect(hybridManaReminderText(card.manaCost)).toBe('({G/W} can be paid with either {G} or {W}.)');
    expect(renderOracleText(card)).toBe(
      'If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead.',
    );
  });

  it('keeps the exact replacement outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(REPLACE_SPELL_CARD_MOVES).success).toBe(false);
  });

  it('admits only the symmetric player scope for the filtered rule', () => {
    expect(() =>
      parseCard({
        ...DRYAD_MILITANT,
        abilities: [{ ...REPLACE_SPELL_CARD_MOVES, players: 'eachOpponent' as const }],
      }),
    ).toThrow(/instantOrSorceryCardsToGraveyardAreExiled requires the eachPlayer player scope/);
  });

  it('refuses the printed hybrid reminder without exactly one matching hybrid pip', () => {
    expect(() =>
      parseCard({
        ...DRYAD_MILITANT,
        manaCost: { G: 1 },
      }),
    ).toThrow(/printed hybrid mana reminder requires exactly one hybrid mana symbol/);
    expect(() =>
      parseCard({
        ...DRYAD_MILITANT,
        manaCost: { hybrid: { 'G/W': 2 } },
      }),
    ).toThrow(/printed hybrid mana reminder requires exactly one hybrid mana symbol/);
  });
});
