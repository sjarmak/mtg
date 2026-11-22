/** Forge 2.0.14's three M13 scripts pin the block-rule export grammar. */
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';

function scriptOf(card: ReturnType<typeof parseCard>): string {
  const result = transpileCard(card);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('M13 block-rule card did not export');
  return result.script.text;
}

describe('M13 block-rule Forge parity', () => {
  it('exports Courtly Provocateur through a remembered MustBlock static', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-courtly-provocateur',
      name: 'Courtly Provocateur',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 46 },
      manaCost: { generic: 2, U: 1 },
      colors: ['U'],
      subtypes: ['Human', 'Wizard'],
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [{ kind: 'blocksThisTurnIfAble', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const text = scriptOf(card);
    expect(text).toContain(
      'A:AB$ Effect | Cost$ T | ValidTgts$ Creature | StaticAbilities$ MustBlock | RememberObjects$ Targeted | ExileOnMoved$ Battlefield',
    );
    expect(text).toContain(
      'SVar:MustBlock:Mode$ MustBlock | ValidCreature$ Card.IsRemembered | Description$ This creature blocks this turn if able.',
    );
  });

  it("exports Jester's color/controller trigger and hidden can't-block Pump", () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-goblin-battle-jester',
      name: 'Goblin Battle Jester',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 135 },
      manaCost: { generic: 3, R: 1 },
      colors: ['R'],
      subtypes: ['Goblin'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'youCastSpell',
          spellColors: ['R'],
          effects: [{ kind: 'cantBlockThisTurn', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const text = scriptOf(card);
    expect(text).toContain(
      'T:Mode$ SpellCast | ValidCard$ Card.Red | ValidActivatingPlayer$ You | TriggerZones$ Battlefield',
    );
    expect(text).toContain(
      "DB$ Pump | ValidTgts$ Creature | IsCurse$ True | KW$ HIDDEN CARDNAME can't block.",
    );
  });

  it('exports Rampage as PumpAll followed by the opposing MustBlock static', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm13-predatory-rampage',
      name: 'Predatory Rampage',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 180 },
      manaCost: { generic: 3, G: 2 },
      colors: ['G'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 3,
          toughness: 3,
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
        {
          kind: 'blocksThisTurnIfAble',
          target: { kind: 'noTarget' },
          scope: 'permanentsOpponentsControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    });
    const text = scriptOf(card);
    expect(text).toContain(
      'A:SP$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ +3 | NumDef$ +3 | SubAbility$ DBEffect1',
    );
    expect(text).toContain('SVar:DBEffect1:DB$ Effect | StaticAbilities$ STBlock');
    expect(text).toContain(
      'SVar:STBlock:Mode$ MustBlock | ValidCreature$ Creature.OppCtrl | Description$ Each creature your opponents control blocks this turn if able.',
    );
  });
});
