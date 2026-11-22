/** Spelltwine's two graveyard targets and castable card-copy instruction. */
import { describe, expect, it } from 'vitest';
import {
  HAND_AUTHORED_TARGETS,
  MODEL_EFFECT_KINDS,
  MODEL_TARGET_KINDS,
  ModelEffectSchema,
  ModelTargetSpecSchema,
  TargetSpecSchema,
  parseCard,
  renderOracleText,
  type CardInput,
  type EffectInput,
  type TargetKind,
} from '../src/index';

const CAST_EXILED_COPIES = {
  kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
} as EffectInput;

export const SPELLTWINE_INPUT = {
  kind: 'sorcery',
  id: 'm13-72-spelltwine',
  name: 'Spelltwine',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 72 },
  manaCost: { generic: 5, U: 1 },
  colors: ['U'],
  effects: [
    {
      kind: 'exileTarget',
      target: {
        kind: 'targetCardInYourGraveyard',
        filter: { cardTypes: ['instant', 'sorcery'] },
      },
    },
    {
      kind: 'exileTarget',
      target: {
        kind: 'targetCardInOpponentsGraveyard',
        filter: { cardTypes: ['instant', 'sorcery'] },
      },
    },
    CAST_EXILED_COPIES,
    { kind: 'exileThisSpell' },
  ],
} as CardInput;

describe('Spelltwine', () => {
  it('parses and renders the current Oracle text exactly', () => {
    const card = parseCard(SPELLTWINE_INPUT);

    expect(renderOracleText(card)).toBe(
      "Exile target instant or sorcery card from your graveyard and target instant or sorcery card from an opponent's graveyard. Copy those cards. Cast the copies if able without paying their mana costs. Exile Spelltwine.",
    );
  });

  it('keeps both capabilities hand-authored and outside generator schemas', () => {
    const opposing = 'targetCardInOpponentsGraveyard' as TargetKind;
    const castCopies = 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts';

    expect(TargetSpecSchema.safeParse({ kind: opposing }).success).toBe(true);
    expect(ModelTargetSpecSchema.safeParse({ kind: opposing }).success).toBe(false);
    expect(MODEL_TARGET_KINDS).not.toContain(opposing);
    expect(HAND_AUTHORED_TARGETS.exileTarget).toContain(opposing);
    expect(ModelEffectSchema.safeParse({ kind: castCopies }).success).toBe(false);
    expect(MODEL_EFFECT_KINDS).not.toContain(castCopies);
  });
});
