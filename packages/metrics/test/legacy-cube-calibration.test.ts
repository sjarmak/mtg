import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import {
  draftCalibrationPool,
  buildCalibrationDeck,
  calibrationSeed,
  scheduleCalibrationGames,
  summarizeCalibrationGames,
  competenceForDeck,
} from '../src/legacy-cube-calibration/index';

const catalog = parsePrintedCardCatalog(catalogJson);
const cards = (names: readonly string[]) =>
  names.map((name) => {
    const card = catalog.cards.find((entry) => entry.correctedName === name);
    if (!card) throw new Error(`Unknown fixture ${name}`);
    return card;
  });

describe('Legacy Cube bot calibration', () => {
  it('replays a candidate weight revision without changing the fixed draft baseline', () => {
    const weights = { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'test-candidate', quality: 2 };
    const baseline = draftCalibrationPool(catalog, 'weight-replay', 'power');
    const candidate = draftCalibrationPool(catalog, 'weight-replay', 'power', weights);
    expect(candidate.weights).toEqual(weights);
    expect(candidate.pool).toEqual(baseline.pool);
    expect(candidate.opponentPools).toEqual(baseline.opponentPools);
    const advised = draftCalibrationPool(catalog, 'weight-replay', 'current', weights);
    expect(advised).toEqual(draftCalibrationPool(catalog, 'weight-replay', 'current', weights));
    expect(advised.weights).toEqual(weights);
  });
  it('separates tuning, holdout, draft and game randomness without policy in the seed', () => {
    const seeds = ['tuning', 'holdout'].flatMap((split) =>
      ['draft', 'game'].map((stage) =>
        calibrationSeed('experiment', split as 'tuning' | 'holdout', stage as 'draft' | 'game', 0),
      ),
    );
    expect(new Set(seeds).size).toBe(4);
    expect(() => calibrationSeed('', 'tuning', 'draft', 0)).toThrow();
    expect(() => calibrationSeed('x', 'tuning', 'draft', -1)).toThrow();
  });

  it('replays 45 explained picks from only observed packs and rejects unknown pins', () => {
    const seed = calibrationSeed('smoke', 'tuning', 'draft', 0);
    const first = draftCalibrationPool(catalog, seed, 'current');
    expect(draftCalibrationPool(catalog, seed, 'current')).toEqual(first);
    expect(first.pool).toHaveLength(45);
    expect(new Set(first.pool.map((c) => c.physicalId)).size).toBe(45);
    expect(first.trace).toHaveLength(45);
    expect(first.trace.every((p) => p.reasons.length > 0 && p.seen.includes(p.chosen))).toBe(true);
    const visible = new Set<string>();
    for (const pick of first.trace) {
      pick.seen.forEach((id) => visible.add(id));
      expect(pick.reasons.every((r) => r.cards.every((id) => visible.has(id)))).toBe(true);
    }
    expect(() => draftCalibrationPool(catalog, seed, 'pin:unknown')).toThrow(/archetype/);
  });

  it.each(['power', 'flexible', 'pivot', 'pin:reanimator'] as const)(
    'builds a legal owned 40-card deck for %s with explicit fallback decisions',
    (policy) => {
      const draft = draftCalibrationPool(catalog, 'builder-smoke', policy);
      const deck = buildCalibrationDeck(draft.pool, policy);
      expect(deck.report.legal).toBe(true);
      expect(deck.report.cards).toBe(40);
      expect(deck.report.basicLands + deck.report.nonbasicLands).toBe(17);
      expect(deck.selected.every((c) => draft.pool.includes(c))).toBe(true);
      expect(new Set(deck.selected.map((c) => c.physicalId)).size).toBe(deck.selected.length);
      expect(deck.ref.cards.reduce((n, c) => n + c.count, 0)).toBe(40);
      expect(deck.builderVersion).toBeTruthy();
    },
  );

  it('will not certify a package from missing, failed or stale bot evidence', () => {
    const pool = cards(['Reanimate', 'Entomb', 'Griselbrand']);
    expect(competenceForDeck(pool, [], 'bot-a').eligible).toBe(false);
    const evidence = [
      {
        interaction: 'reanimate',
        bot: 'bot-a',
        status: 'passed' as const,
        artifact: 'probe.json',
        seeds: ['a', 'b'],
        coverage: ['Reanimate', 'Entomb', 'Griselbrand'],
      },
    ];
    expect(competenceForDeck(pool, evidence, 'bot-a').missing).not.toContain('reanimate');
    expect(competenceForDeck(pool, evidence, 'bot-b').missing).toContain('reanimate');
    expect(competenceForDeck(pool, [{ ...evidence[0]!, status: 'failed' }], 'bot-a').missing).toContain(
      'reanimate',
    );
    // A single enabled narrow card still needs its bot interaction tested.
    expect(competenceForDeck(cards(['Splinter Twin']), [], 'bot-a').required).toContain('twin-combo');
  });

  it('never generalizes one reanimation probe to untested spells, targets or setup', () => {
    const evidence = [
      {
        interaction: 'reanimate',
        bot: 'bot-a',
        status: 'passed' as const,
        artifact: 'probe.json',
        seeds: ['a', 'b'],
        coverage: ['Reanimate', 'Griselbrand'],
      },
    ];
    expect(competenceForDeck(cards(['Reanimate', 'Griselbrand']), evidence, 'bot-a').missing).not.toContain(
      'reanimate',
    );
    for (const name of ['Exhume', 'Animate Dead', 'Necromancy', 'Entomb', 'Archon of Cruelty']) {
      const result = competenceForDeck(cards(['Reanimate', name]), evidence, 'bot-a');
      expect(result.missing).toContain('reanimate');
      expect(result.uncovered.find((r) => r.interaction === 'reanimate')?.cards).toContain(name);
    }
    expect(
      competenceForDeck(cards(['Reanimate']), [{ ...evidence[0]!, coverage: [] }], 'bot-a').missing,
    ).toContain('reanimate');
  });

  it('does not certify an untested pair by combining two unrelated probe coverages', () => {
    const evidence = ['Reanimate', 'Griselbrand'].map((name) => ({
      interaction: 'reanimate',
      bot: 'bot-a',
      status: 'passed' as const,
      artifact: name,
      seeds: ['a', 'b'],
      coverage: [name],
    }));
    expect(competenceForDeck(cards(['Reanimate', 'Griselbrand']), evidence, 'bot-a').missing).toContain(
      'reanimate',
    );
  });

  it('keeps an assembled reanimation package instead of cutting its expensive target for curve', () => {
    const pieces = cards(['Reanimate', 'Entomb', 'Griselbrand']);
    const filler = catalog.cards
      .filter(
        (c) =>
          c.colors.every((color) => ['U', 'B'].includes(color)) &&
          c.manaValue >= 2 &&
          c.manaValue <= 4 &&
          !c.typeLine.includes('Land') &&
          !pieces.includes(c),
      )
      .slice(0, 30);
    const deck = buildCalibrationDeck([...pieces, ...filler], 'assembled');
    expect(pieces.every((piece) => deck.selected.includes(piece))).toBe(true);
    expect(deck.packages).toContain('reanimate');
  });

  it('pairs identical game seeds with reversed seats and fixed opponent decks across policies', () => {
    const draft = draftCalibrationPool(catalog, 'schedule-smoke', 'power');
    const deck = buildCalibrationDeck(draft.pool, 'candidate');
    const games = scheduleCalibrationGames(
      'exp',
      'holdout',
      2,
      [
        { policy: 'power', deck },
        { policy: 'current', deck },
      ],
      [deck],
      2,
    );
    expect(games).toHaveLength(8);
    expect(games[0]!.seed).toBe(games[1]!.seed);
    expect(games[0]!.candidateSeat).not.toBe(games[1]!.candidateSeat);
    expect(games[0]!.seed).toBe(games[4]!.seed);
    expect(new Set(games.map((g) => g.id)).size).toBe(8);
  });

  it('never turns unproven bot behavior or unfinished games into losses', () => {
    const rows = [
      { id: '1', policy: 'current', pod: 0, eligible: true, outcome: 'win' as const },
      { id: '2', policy: 'current', pod: 0, eligible: true, outcome: 'loss' as const },
      { id: '3', policy: 'current', pod: 1, eligible: false, outcome: 'loss' as const },
      { id: '4', policy: 'current', pod: 1, eligible: true, outcome: 'incomplete' as const },
    ];
    const [summary] = summarizeCalibrationGames(rows);
    expect(summary).toMatchObject({ wins: 1, losses: 1, excluded: 1, incomplete: 1, pods: 1, winRate: 0.5 });
    expect(summary!.interval).toBeNull(); // One pod is not two independent observations.
    expect(() => summarizeCalibrationGames([...rows, rows[0]!])).toThrow(/Duplicate/);
    expect(summarizeCalibrationGames([{ ...rows[0]!, eligible: false }])[0]!.winRate).toBeNull();
  });
});
