/** Forge's shipped Harbor Serpent whole-battlefield threshold grammar. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'creature',
  id: 'tst-harbor-serpent',
  name: 'Harbor Serpent',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 56 },
  colors: ['U'],
  manaCost: { generic: 4, U: 2 },
  power: 5,
  toughness: 5,
  subtypes: ['Serpent'],
  keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: {
        kind: 'battlefieldCountBelow',
        filter: { subtypes: ['Island'] },
        fewerThan: 5,
      },
      modification: { kind: 'cantAttack' },
    },
  ],
});

describe('Harbor Serpent Forge parity', () => {
  it('matches the shipped CantAttack and IsPresent grammar', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('K:Landwalk:Island');
    expect(result.script.text).toContain(
      "S:Mode$ CantAttack | ValidCard$ Card.Self | IsPresent$ Island | PresentCompare$ LT5 | Description$ CARDNAME can't attack unless there are five or more Islands on the battlefield.",
    );
  });
});
