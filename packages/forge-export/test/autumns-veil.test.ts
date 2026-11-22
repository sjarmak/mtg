/** Forge parity for Autumn's Veil's two command-zone rules. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const AUTUMNS_VEIL = parseCard({
  kind: 'instant',
  id: 'm11-162-autumns-veil-forge',
  name: "Autumn's Veil",
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 162 },
  manaCost: { G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'protectSpellsAndCreaturesFromSpellColorsThisTurn',
      colors: ['U', 'B'],
    },
  ],
} as unknown as CardInput);

describe("Autumn's Veil Forge parity", () => {
  it('matches Forge master Effect, AntiMagic, and CantTarget grammar exactly', () => {
    const result = transpileCard(AUTUMNS_VEIL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text).toContain(
      "A:SP$ Effect | ReplacementEffects$ AntiMagic | StaticAbilities$ STCantBeTarget | SpellDescription$ Spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn.",
    );
    expect(result.script.text).toContain(
      "SVar:AntiMagic:Event$ Counter | ValidSA$ Spell.YouCtrl | ValidCause$ Spell.Blue,Spell.Black | Layer$ CantHappen | Description$ Spells you control can't be countered by blue or black spells this turn.",
    );
    expect(result.script.text).toContain(
      "SVar:STCantBeTarget:Mode$ CantTarget | ValidTarget$ Creature.YouCtrl | ValidSource$ Card.Blue,Card.Black | ValidSA$ Spell | Description$ Creatures you control can't be the targets of blue or black spells this turn.",
    );
  });
});
