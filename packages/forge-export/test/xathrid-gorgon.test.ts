/** Exact Forge parity for Xathrid Gorgon's persistent petrification. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const XATHRID = parseCard({
  kind: 'creature',
  id: 'm13-118-xathrid-gorgon-forge',
  name: 'Xathrid Gorgon',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 118 },
  manaCost: { generic: 5, B: 1 },
  colors: ['B'],
  subtypes: ['Gorgon'],
  power: 3,
  toughness: 6,
  keywords: ['deathtouch'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, B: 1 }, tapSelf: true },
      effects: [{ kind: 'petrifyCreature', target: { kind: 'targetCreature' } }],
    },
  ],
});

describe('Xathrid Gorgon Forge parity', () => {
  it('exports the shipped counter, animation, and remembered activation lock contract', () => {
    const result = transpileCard(XATHRID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text.split('\n')).toEqual(
      expect.arrayContaining([
        "A:AB$ PutCounter | Cost$ 2 B T | ValidTgts$ Creature | CounterNum$ 1 | CounterType$ PETRIFICATION | IsCurse$ True | SubAbility$ Act1Effect2 | SpellDescription$ Put a petrification counter on target creature. It gains defender and becomes a colorless artifact in addition to its other types. Its activated abilities can't be activated. (A creature with defender can't attack.)",
        'SVar:Act1Effect2:DB$ Animate | Defined$ Targeted | Keywords$ Defender | Colors$ Colorless | OverwriteColors$ True | Types$ Artifact | Duration$ Permanent | SubAbility$ Act1Effect3',
        'SVar:Act1Effect3:DB$ Effect | RememberObjects$ Targeted | StaticAbilities$ PetrificationCantActivate | ForgetOnMoved$ Battlefield | Duration$ Permanent',
        "SVar:PetrificationCantActivate:Mode$ CantBeActivated | ValidCard$ Card.IsRemembered | Description$ Its activated abilities can't be activated.",
      ]),
    );
  });
});
