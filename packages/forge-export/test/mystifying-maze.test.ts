/** Source-attested Forge script parity for Mystifying Maze. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Mystifying Maze', () => {
  /**
   * Source: Card-Forge/forge master on 2026-08-24,
   * `forge-gui/res/cardsfolder/m/mystifying_maze.txt`.
   */
  it('exports the opposing-attacker selector and retained delayed return', () => {
    const card = parseCard({
      kind: 'land',
      id: 'm11-226',
      name: 'Mystifying Maze',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 226 },
      colors: [],
      producesMana: ['C'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 4 }, tapSelf: true },
          effects: [
            {
              kind: 'exileTarget',
              target: {
                kind: 'targetCreatureOpponentControls',
                filter: { combat: 'attacking' },
              },
              returnAtNextEndStep: { tapped: true, under: 'owner' },
            },
          ],
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Mystifying Maze',
        'ManaCost:no cost',
        'Types:Land',
        'A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add {C}.',
        "A:AB$ ChangeZone | Cost$ 4 T | ValidTgts$ Creature.attacking+OppCtrl | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SubAbility$ Act1Effect2 | SpellDescription$ Exile target attacking creature an opponent controls. At the beginning of the next end step, return it to the battlefield tapped under its owner's control.",
        'SVar:Act1Effect2:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ DelayedZoneReturn | RememberObjects$ RememberedLKI | TriggerDescription$ Return exiled card to the battlefield. | SubAbility$ Act1Effect3',
        'SVar:Act1Effect3:DB$ Cleanup | ClearRemembered$ True',
        'SVar:DelayedZoneReturn:DB$ ChangeZone | Origin$ Exile | Destination$ Battlefield | Defined$ DelayTriggerRememberedLKI | Tapped$ True',
        "Oracle:{T}: Add {C}.\\n{4}, {T}: Exile target attacking creature an opponent controls. At the beginning of the next end step, return it to the battlefield tapped under its owner's control.",
        '',
      ].join('\n'),
    );
  });
});
