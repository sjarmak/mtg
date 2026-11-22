import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@mtg/bot-evidence';
import { metricsConfig } from '@mtg/metrics';
import type { ForgeGameplayEvidence } from '../src/forge-play-card-rating';
import { forgeEpisodeWinRateRow, forgePlayCardRatings } from '../src/forge-play-card-rating';

const config = metricsConfig({ floors: { card: 4 } });

/** A decision whose masked view shows `names` in the candidate's own hand and nothing in the opponent's. */
function decisionWith(names: readonly string[]) {
  const value: JsonValue = {
    view: {
      seats: [{ hand: names.map((name) => ({ name })) }, { hand: null }],
    },
  };
  return { observation: { value } };
}

function episode(id: string, decisions: ForgeGameplayEvidence['decisions']): ForgeGameplayEvidence {
  return { episode: { id }, decisions };
}

describe('forgeEpisodeWinRateRow', () => {
  it('records every name ever visible in a hand across the transcript, deduplicated', () => {
    const row = forgeEpisodeWinRateRow(
      episode('game-1', [decisionWith(['Plains', 'Griffin Rider']), decisionWith(['Plains'])]),
      true,
    );
    expect(row).toEqual({
      won: true,
      fingerprint: 'game-1',
      cards: {
        Plains: { opening_hand: 0, drawn: 1 },
        'Griffin Rider': { opening_hand: 0, drawn: 1 },
      },
    });
  });

  it('uses the episode id as the fingerprint', () => {
    const row = forgeEpisodeWinRateRow(episode('game-42', [decisionWith(['Plains'])]), false);
    expect(row?.fingerprint).toBe('game-42');
    expect(row?.won).toBe(false);
  });

  it('returns null when the transcript carries no visible hand at all', () => {
    expect(forgeEpisodeWinRateRow(episode('game-3', []), true)).toBeNull();
    expect(forgeEpisodeWinRateRow(episode('game-4', [decisionWith([])]), true)).toBeNull();
  });

  it('ignores a decision whose observation is not the expected shape', () => {
    const malformed = { observation: { value: 'not-an-object' as unknown as JsonValue } };
    const row = forgeEpisodeWinRateRow(episode('game-5', [malformed, decisionWith(['Plains'])]), true);
    expect(row?.cards).toEqual({ Plains: { opening_hand: 0, drawn: 1 } });
  });
});

/** Four wins with Charge, four losses with Cleric; Sentinel is in all eight. */
function eightGames(): readonly ReturnType<typeof forgeEpisodeWinRateRow>[] {
  return Array.from({ length: 8 }, (_unused, index) => {
    const won = index < 6;
    const names =
      index < 4 ? ['Skywatch Sentinel', 'Radiant Charge'] : ['Skywatch Sentinel', 'Lifebound Cleric'];
    return forgeEpisodeWinRateRow(episode(`game-${String(index)}`, [decisionWith(names)]), won);
  });
}

describe('forgePlayCardRatings', () => {
  it('min-max scales measured win rate onto the [0, 5] band', () => {
    const rows = eightGames().flatMap((row) => (row === null ? [] : [row]));
    const ratings = forgePlayCardRatings(
      ['Skywatch Sentinel', 'Radiant Charge', 'Lifebound Cleric'],
      rows,
      config,
    );
    const find = (name: string) => ratings.find((entry) => entry.cardName === name);
    expect(find('Lifebound Cleric')?.quality).toBe(0);
    expect(find('Skywatch Sentinel')?.quality).toBe(2.5);
    expect(find('Radiant Charge')?.quality).toBe(5);
  });

  it('gives an under-sampled name no rating at all', () => {
    const rows = eightGames().flatMap((row) => (row === null ? [] : [row]));
    const ratings = forgePlayCardRatings(['Skywatch Sentinel', 'One-Off Curiosity'], rows, config);
    expect(ratings.some((entry) => entry.cardName === 'One-Off Curiosity')).toBe(false);
  });

  it('returns no ratings when nothing clears the floor', () => {
    const single = forgeEpisodeWinRateRow(episode('game-solo', [decisionWith(['Plains'])]), true);
    expect(forgePlayCardRatings(['Plains'], single === null ? [] : [single], config)).toEqual([]);
  });
});
