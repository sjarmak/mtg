/** Forge's shipped Gargoyle Sentinel Debuff -> Pump chain. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'creature',
  id: 'm11-207',
  name: 'Gargoyle Sentinel',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 207 },
  colors: [],
  manaCost: { generic: 3 },
  artifact: true,
  subtypes: ['Gargoyle'],
  power: 3,
  toughness: 3,
  keywordAbilities: [{ kind: 'defender' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 3 } },
      effects: [
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'flying',
          removeKeywordAbility: 'defender',
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

describe('Gargoyle Sentinel Forge parity', () => {
  it('matches the source-bounded Debuff followed by Pump spelling', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.script.text.split('\n');
    const activation = lines.find((line) => line.startsWith('A:')) ?? '';
    const followName = /SubAbility\$ ([^ |]+)/.exec(activation)?.[1] ?? '';
    const follow = lines.find((line) => line.startsWith(`SVar:${followName}:`)) ?? '';
    expect(activation).toContain('AB$ Debuff');
    expect(activation).toContain('Defined$ Self');
    expect(activation).toContain('Keywords$ Defender');
    expect(followName).not.toBe('');
    expect(follow).toContain('DB$ Pump');
    expect(follow).toContain('Defined$ Self');
    expect(follow).toContain('KW$ Flying');
  });
});
