import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';

describe('bounded reference keyword export', () => {
  it('emits the source-proven Forge keyword spellings', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'forge-reference-keywords',
      name: 'Forge Reference Keywords',
      rarity: 'rare',
      set: { code: 'REF', collectorNumber: 1 },
      manaCost: { W: 1 },
      colors: ['W'],
      power: 2,
      toughness: 2,
      keywordAbilities: [
        { kind: 'defender' },
        { kind: 'landwalk', landType: 'Swamp' },
        { kind: 'hexproof' },
        { kind: 'indestructible' },
        { kind: 'protection', quality: { kind: 'color', color: 'B' } },
        { kind: 'protection', quality: { kind: 'subtype', subtype: 'Dragon' } },
      ],
    });
    const result = transpileCardScript(card);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toEqual(
      expect.arrayContaining([
        'K:Defender',
        'K:Swampwalk',
        'K:Hexproof',
        'K:Indestructible',
        'K:Protection from black',
        'K:Protection from Dragon',
      ]),
    );
  });

  /**
   * `mtg-rji`: the DSL now lets a noncreature permanent print indestructible or
   * hexproof, so the exporter is asked for a `K:` line on a card that has no
   * `PT:` above it. It already was — `keywordLines` runs for every card kind
   * and `forgeKeywordAbility` switches on the ability rather than the card — and
   * both words are Forge keywords in their own right, so a Legendary Artifact
   * needs no new mapping. This pins that rather than leaving it inferred from a
   * creature-only fixture.
   */
  it('emits the same keyword lines for a noncreature permanent', () => {
    const trisigil = parseCard({
      kind: 'artifact',
      id: 'forge-reference-trisigil',
      name: 'The Trisigil',
      rarity: 'mythic',
      set: { code: 'REF', collectorNumber: 3 },
      manaCost: { generic: 3 },
      supertypes: ['legendary'],
      keywordAbilities: [{ kind: 'indestructible' }],
    });
    const result = transpileCardScript(trisigil);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toContain('K:Indestructible');
    expect(result.value.lines).toContain('Types:Legendary Artifact');
    expect(result.value.lines).toContain('Oracle:Indestructible');
    expect(result.value.lines.some((line) => line.startsWith('PT:'))).toBe(false);
  });

  /**
   * `mtg-zd0y`. Two words rather than one, and capitalized on both: Forge's
   * keyword is `Double Strike`, so the spelling is worth pinning next to
   * `Swampwalk`, whose shape it does not share. The DSL kind is one word
   * (`doubleStrike`) and the printed line is sentence case (`Double strike`),
   * which makes three spellings of one keyword and exactly one of them right
   * here.
   */
  it('emits the two-word Forge spelling of double strike', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'forge-reference-double-strike',
      name: 'Forge Reference Double Strike',
      rarity: 'uncommon',
      set: { code: 'REF', collectorNumber: 4 },
      manaCost: { R: 1, generic: 2 },
      colors: ['R'],
      power: 2,
      toughness: 2,
      keywordAbilities: [{ kind: 'doubleStrike' }],
    });
    const result = transpileCardScript(card);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toContain('K:Double Strike');
    expect(result.value.lines).toContain('Oracle:Double strike');
  });

  it('exports self-regeneration as Forge Regenerate rather than a surrogate effect', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'forge-reference-regeneration',
      name: 'Forge Reference Regeneration',
      rarity: 'common',
      set: { code: 'REF', collectorNumber: 2 },
      manaCost: { G: 1 },
      colors: ['G'],
      power: 2,
      toughness: 2,
      abilities: [{ kind: 'activated', cost: { mana: { G: 1 } }, regenerateSelf: true, effects: [] }],
    });
    const result = transpileCardScript(card);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toContain(
      'A:AB$ Regenerate | Cost$ G | SpellDescription$ {G}: Regenerate this creature.',
    );
  });
});
