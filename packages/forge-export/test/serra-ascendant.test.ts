/**
 * Forge parity for Serra Ascendant's controller-life conditional static.
 *
 * Two deviations from `serra_ascendant.txt`, neither a grammar. The first is a
 * name: master writes `CheckSVar$ X` here, we write `CheckSVar$ YourLife`.
 * Both are shipped spellings of the same count (45 scripts define
 * `SVar:X:Count$YourLifeTotal`, 2 define `SVar:YourLife:`), and the two that
 * pick `YourLife` are the two where `X` was already taken by something else on
 * the card. Forge's authors chose per card; a condition writer here cannot see
 * what the rest of the card wrote, so it picks the name that never collides.
 * `elderscale-wurm.test.ts` is the card that forced the choice.
 *
 * The second is a split: master carries the stat bonus and the granted keyword
 * on one `S:` line and this writes two, because the card prints them as two
 * `static` abilities and each ability is one line. Forge reads the pair the
 * same either way — both lines carry the same `Affected$` and the same
 * condition, and MODIFYPT and ABILITIES are separate layers regardless.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const THRESHOLD = { kind: 'controllerLifeAtLeast' as const, atLeast: 30 };

const CARD = parseCard({
  kind: 'creature',
  id: 'tst-serra-ascendant',
  name: 'Serra Ascendant',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 28 },
  colors: ['W'],
  manaCost: { W: 1 },
  power: 1,
  toughness: 1,
  subtypes: ['Human', 'Monk'],
  keywords: ['lifelink'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: THRESHOLD,
      modification: { kind: 'statBonus', power: 5, toughness: 5 },
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: THRESHOLD,
      modification: { kind: 'grantKeyword', keyword: 'flying' },
    },
  ],
});

describe('Serra Ascendant Forge parity', () => {
  it('matches Forge master 0c9f64a Count YourLifeTotal GE30 grammar without a card-name branch', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 5 | AddToughness$ 5 | CheckSVar$ YourLife | SVarCompare$ GE30 | Description$ As long as you have 30 or more life, CARDNAME gets +5/+5.',
    );
    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self | AddKeyword$ Flying | CheckSVar$ YourLife | SVarCompare$ GE30 | Description$ As long as you have 30 or more life, CARDNAME has flying.',
    );
    expect(lines.filter((line) => line === 'SVar:YourLife:Count$YourLifeTotal')).toHaveLength(1);
  });
});
