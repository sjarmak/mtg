import { describe, expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import { buildInformedDeck } from '../src/build';
import {
  parseConstructedGameplayComparison,
  summarizeConstructedGameplayComparison,
} from '../src/constructed-evaluation';
import { DeckCriteriaSchema } from '../src/criteria';
import { setDeckPool, type PoolSet } from '../src/pool';
import { scriptedProvider } from './support/scripted-provider';

const BUILD_SHA = 'a'.repeat(64);
const CONFIG_SHA = 'b'.repeat(64);

function creature(index: number): Card {
  return parseCard({
    kind: 'creature',
    id: `hld-creature-${String(index)}`,
    name: `Holdout Creature ${String(index)}`,
    rarity: 'common',
    set: { code: 'HLD', collectorNumber: index },
    manaCost: { generic: index % 3, G: 1 },
    colors: ['G'],
    subtypes: ['Beast'],
    power: 2,
    toughness: 2,
  } as CardInput);
}

const HOLDOUT: PoolSet = {
  code: 'HLD',
  name: 'held-out fixture',
  cards: Array.from({ length: 18 }, (_unused, index) => creature(index + 1)),
};

const CRITERIA = DeckCriteriaSchema.parse({
  prompt: 'a green deck tuned for the held-out field',
  sets: ['HLD'],
  colors: ['G'],
  size: 60,
  landCount: 24,
  archetype: 'midrange',
  opponentPopulation: {
    id: 'held-out-field',
    members: [{ id: 'pressure', share: 1, strategy: 'curve out with creatures' }],
  },
});

async function candidate(id: string, cardIndexes: readonly number[]) {
  const provider = scriptedProvider([
    {
      plan: `${id} plan`,
      cards: cardIndexes.map((index) => ({
        name: `Holdout Creature ${String(index)}`,
        count: 4,
        criteria: ['sets', 'archetype', 'opponents'],
        reason: `${id} role`,
      })),
    },
  ]);
  const built = await buildInformedDeck({
    pool: setDeckPool([HOLDOUT], CRITERIA),
    provider,
    criteria: CRITERIA,
    maxRounds: 1,
  });
  const deckSha256 = botEvidenceSha256({
    spells: built.deck.spells.map((entry) => ({ id: entry.card.oracleId, count: entry.count })),
    basics: built.deck.manaBase.basics,
  });
  return { id, built, deckSha256 };
}

describe('held-out constructed candidates', () => {
  it('builds and compares legal 60-card candidates without a set-specific table', async () => {
    const baseline = await candidate('baseline', [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const challenger = await candidate('challenger', [10, 11, 12, 13, 14, 15, 16, 17, 18]);

    for (const entry of [baseline, challenger]) {
      expect(entry.built.deck.totalCards).toBe(60);
      expect(entry.built.shortBy).toBe(0);
      expect(entry.built.deck.spells.every((spell) => spell.count <= 4)).toBe(true);
      expect(entry.built.construction.format).toMatchObject({
        source: { kind: 'sets', sets: ['HLD'] },
        deckSize: 60,
        landCount: 24,
        spellCount: 36,
        copyLimit: 4,
        opponentPopulation: { id: 'held-out-field' },
      });
    }

    const comparison = parseConstructedGameplayComparison({
      schemaVersion: 1,
      id: 'held-out-pair',
      engine: { kind: 'native', version: 'kernel-test', buildSha256: BUILD_SHA },
      gameplay: { policyId: 'native-search/v2', configSha256: CONFIG_SHA },
      match: { kind: 'independent-games', sideboarding: 'absent', gamesPerPair: 2 },
      gauntlet: {
        id: 'held-out-field',
        opponents: [{ id: 'pressure', deckSha256: BUILD_SHA, share: 1 }],
      },
      candidates: [
        { id: baseline.id, deckSha256: baseline.deckSha256 },
        { id: challenger.id, deckSha256: challenger.deckSha256 },
      ],
      games: [
        {
          id: 'b1',
          seed: 'pair-1',
          candidateId: 'baseline',
          opponentId: 'pressure',
          candidateSeat: 0,
          result: 'loss',
        },
        {
          id: 'b2',
          seed: 'pair-2',
          candidateId: 'baseline',
          opponentId: 'pressure',
          candidateSeat: 1,
          result: 'win',
        },
        {
          id: 'c1',
          seed: 'pair-1',
          candidateId: 'challenger',
          opponentId: 'pressure',
          candidateSeat: 0,
          result: 'win',
        },
        {
          id: 'c2',
          seed: 'pair-2',
          candidateId: 'challenger',
          opponentId: 'pressure',
          candidateSeat: 1,
          result: 'win',
        },
      ],
    });

    expect(baseline.deckSha256).not.toBe(challenger.deckSha256);
    expect(summarizeConstructedGameplayComparison(comparison)).toEqual([
      {
        candidateId: 'baseline',
        games: 2,
        wins: 1,
        losses: 1,
        draws: 0,
        gameWinRate: 0.5,
        populationGameWinRate: 0.5,
      },
      {
        candidateId: 'challenger',
        games: 2,
        wins: 2,
        losses: 0,
        draws: 0,
        gameWinRate: 1,
        populationGameWinRate: 1,
      },
    ]);
  });
});
