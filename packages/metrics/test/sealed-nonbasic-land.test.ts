/** A real Sealed campaign retains an opened checkland through every evidence seam. */
import { describe, expect, it } from 'vitest';
import type { Card, Color } from '@mtg/dsl';
import { cardFingerprint, parseCard } from '@mtg/dsl';
import { readSealedCalibrationArtifact, runSealedCalibration, type SealedCollationInput } from '@mtg/metrics';

function spell(index: number, rarity: 'common' | 'uncommon', color: Color): Card {
  return parseCard({
    kind: 'creature',
    id: `m13-sealed-${rarity}-${String(index)}`,
    name: `Sealed ${color} ${rarity} ${String(index)}`,
    rarity,
    set: { code: 'M13', collectorNumber: index + 1 },
    manaCost: { generic: 1, [color]: 1 },
    colors: [color],
    power: 2,
    toughness: 2,
  });
}

const CHECKLAND = parseCard({
  kind: 'land',
  id: 'm13-dragonskull-summit',
  name: 'Dragonskull Summit',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 222 },
  producesMana: ['B', 'R'],
  entryReplacement: {
    kind: 'entersTappedUnlessControlsLandSubtype',
    landTypes: ['Swamp', 'Mountain'],
  },
});
const SET = [
  ...Array.from({ length: 9 }, (_, index) => spell(index, 'common', index % 2 === 0 ? 'B' : 'R')),
  ...Array.from({ length: 3 }, (_, index) => spell(20 + index, 'uncommon', index % 2 === 0 ? 'R' : 'B')),
  CHECKLAND,
];
const COLLATION: SealedCollationInput = {
  version: 'native-draft-collation-v1',
  recipe: [
    { rarity: 'common', count: 9 },
    { rarity: 'uncommon', count: 3 },
    { rarity: 'rare', count: 1 },
  ],
};

describe('opened nonbasic-land Sealed provenance', () => {
  it('retains the exact opened checkland in decks, mana reports, games, and strict reread', async () => {
    const artifact = await runSealedCalibration(SET, {
      seed: 'sealed-opened-checkland-v1',
      collation: COLLATION,
      poolPairs: 2,
      gamesPerSeatOrder: 2,
      workers: 1,
      cardFloor: 8,
      gameFloor: 8,
    });
    const fingerprint = cardFingerprint(CHECKLAND);
    for (const pool of artifact.pools) {
      expect(
        pool.boosters.every((booster) => booster.cards.some((card) => card.cardId === CHECKLAND.id)),
      ).toBe(true);
    }
    for (const deck of artifact.decks) {
      const retained = deck.cards.filter((card) => card.cardId === CHECKLAND.id);
      expect(retained.length).toBeGreaterThan(0);
      expect(retained.every((card) => card.source === 'opened' && card.fingerprint === fingerprint)).toBe(
        true,
      );
      expect(deck.manaReports.find((report) => report.color === 'B')?.sources).toBeGreaterThanOrEqual(
        retained.length,
      );
      expect(deck.manaReports.find((report) => report.color === 'R')?.sources).toBeGreaterThanOrEqual(
        retained.length,
      );
      for (const card of retained) {
        expect(
          artifact.games
            .filter((game) => game.poolIndex === deck.poolIndex)
            .every((game) => game.cardEvents.some((event) => event.instanceId === card.instanceId)),
        ).toBe(true);
      }
    }
    expect(readSealedCalibrationArtifact(structuredClone(artifact), 'opened checkland')).toEqual(artifact);
  }, 60_000);
});
