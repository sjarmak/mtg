/** Forge parity for Faith's Reward's source-attested graveyard provenance selector. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe("Faith's Reward Forge export", () => {
  it('emits Forge master’s owner and this-turn battlefield-origin selector', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'm13-14-faiths-reward-forge',
      name: "Faith's Reward",
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 14 },
      manaCost: { generic: 3, W: 1 },
      colors: ['W'],
      effects: [
        {
          kind: 'returnFromGraveyard',
          fromBattlefieldThisTurn: true,
          target: { kind: 'noTarget' },
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toContain(
      'A:SP$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | Defined$ ValidGraveyard Permanent.YouOwn+ThisTurnEnteredFrom_Battlefield',
    );
  });
});
