import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import researchCorpus from '../data/legacy-cube-human-evidence-v1.json';
import { admitHumanEvidence } from '../src/legacy-cube-calibration/human-evidence';

const catalog = parsePrintedCardCatalog(catalogJson);
// Synthetic parser fixtures: these URLs and labels are not research evidence.
const source = {
  author: 'Test author',
  url: 'https://example.org/draft',
  published: '2021-08-25',
  session: 'fixture-session',
  origin: 'human' as const,
  environment: 'matched' as const,
  locator: 'First pack screenshot and accompanying pick discussion',
};
const names = catalog.cards.slice(0, 15).map((c) => c.correctedName);
const pick = {
  id: 'fixture-pick',
  split: 'holdout' as const,
  source,
  kind: 'pick' as const,
  observations: [{ round: 1, pickNumber: 1, cards: names }],
  picks: [],
  preference: { mode: 'flexible' as const, acceptable: [names[0]!] },
};
const corpus = (cases: readonly unknown[]) => ({
  schemaVersion: 1,
  catalogSha256: catalog.contentSha256,
  cases,
});

it('resolves admitted pick evidence through the existing physical catalog', () => {
  const result = admitHumanEvidence(corpus([pick]), catalog);
  expect(result.excluded).toEqual([]);
  expect(result.admitted).toHaveLength(1);
  expect(result.admitted[0]!.id).toBe(pick.id);
  expect(result.corpusSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(admitHumanEvidence(corpus([pick]), catalog)).toEqual(result);
});

it('requires an explicit known archetype for exploration labels and keeps it in corpus identity', () => {
  const exploring = {
    ...pick,
    preference: { mode: 'explore', archetype: 'reanimator', acceptable: [names[0]!] },
  };
  const admitted = admitHumanEvidence(corpus([exploring]), catalog);
  expect(admitted.admitted).toHaveLength(1);
  const other = { ...exploring, preference: { ...exploring.preference, archetype: 'ramp' } };
  expect(admitHumanEvidence(corpus([other]), catalog).corpusSha256).not.toBe(admitted.corpusSha256);
  const unknown = { ...exploring, preference: { ...exploring.preference, archetype: 'invented' } };
  expect(admitHumanEvidence(corpus([unknown]), catalog).excluded[0]!.reasons).toContainEqual({
    code: 'unknown-archetype',
    detail: 'invented',
  });
  expect(() =>
    admitHumanEvidence(
      corpus([{ ...pick, preference: { mode: 'explore', acceptable: [names[0]!] } }]),
      catalog,
    ),
  ).toThrow();
  expect(() =>
    admitHumanEvidence(corpus([{ ...pick, preference: { ...pick.preference, archetype: 'ramp' } }]), catalog),
  ).toThrow();
});

it('excludes missing cards without silently replacing them', () => {
  const absent = {
    ...pick,
    observations: [{ round: 1, pickNumber: 1, cards: [...names.slice(1), 'Prismatic Lens'] }],
  };
  const result = admitHumanEvidence(corpus([absent]), catalog);
  expect(result.admitted).toEqual([]);
  expect(result.excluded[0]!.reasons).toContainEqual({ code: 'unknown-card', detail: 'Prismatic Lens' });
});

it.each(['model', 'synthetic'] as const)(
  'does not count %s labels as independent human evidence',
  (origin) => {
    const result = admitHumanEvidence(corpus([{ ...pick, source: { ...source, origin } }]), catalog);
    expect(result.admitted).toEqual([]);
    expect(result.excluded[0]!.reasons).toContainEqual({ code: 'nonhuman-label', detail: origin });
  },
);

it('separates transfer examples and incomplete or future-leaking observations', () => {
  const transfer = { ...pick, source: { ...source, environment: 'transfer' } };
  expect(admitHumanEvidence(corpus([transfer]), catalog).excluded[0]!.reasons[0]!.code).toBe(
    'environment-mismatch',
  );
  const incomplete = { ...pick, observations: [{ round: 1, pickNumber: 3, cards: names.slice(0, 13) }] };
  expect(admitHumanEvidence(corpus([incomplete]), catalog).excluded[0]!.reasons[0]!.code).toBe(
    'invalid-transcript',
  );
  const future = {
    ...pick,
    observations: [...pick.observations, { round: 1, pickNumber: 2, cards: names.slice(1) }],
  };
  expect(admitHumanEvidence(corpus([future]), catalog).excluded[0]!.reasons[0]!.code).toBe(
    'invalid-transcript',
  );
});

it('requires labeled choices to be present in the current pack', () => {
  const absent = {
    ...pick,
    preference: { ...pick.preference, acceptable: [catalog.cards[20]!.correctedName] },
  };
  expect(admitHumanEvidence(corpus([absent]), catalog).excluded[0]!.reasons[0]!.code).toBe(
    'unavailable-choice',
  );
});

it('rejects source/session leakage, duplicate IDs, stale catalogs, and malformed input', () => {
  const tuning = { ...pick, id: 'other', split: 'tuning' };
  expect(() => admitHumanEvidence(corpus([pick, tuning]), catalog)).toThrow(/split/i);
  expect(() =>
    admitHumanEvidence(
      corpus([pick, { ...tuning, source: { ...source, url: 'https://example.org/other' } }]),
      catalog,
    ),
  ).toThrow(/split/i);
  expect(() =>
    admitHumanEvidence(corpus([pick, { ...tuning, source: { ...source, session: 'other' } }]), catalog),
  ).toThrow(/split/i);
  expect(() => admitHumanEvidence(corpus([pick, pick]), catalog)).toThrow(/duplicate/i);
  expect(() => admitHumanEvidence({ ...corpus([]), catalogSha256: '0'.repeat(64) }, catalog)).toThrow(
    /catalog/i,
  );
  expect(() => admitHumanEvidence({ ...corpus([]), hiddenPacks: [] }, catalog)).toThrow();
  expect(() =>
    admitHumanEvidence(corpus([{ ...pick, source: { ...source, url: 'file:///secrets' } }]), catalog),
  ).toThrow();
});

it('accounts for complete decks, basic lands, and front-face aliases without substitutions', () => {
  const deck = {
    id: 'fixture-deck',
    split: 'holdout',
    source,
    kind: 'deck',
    cards: [
      ...catalog.cards
        .filter((c) => !c.correctedName.startsWith('Kytheon,'))
        .slice(0, 22)
        .map((c) => ({ name: c.correctedName, count: 1 })),
      { name: 'Kytheon, Hero of Akros', count: 1 },
      { name: 'Plains', count: 17 },
    ],
  };
  expect(admitHumanEvidence(corpus([deck]), catalog).admitted).toHaveLength(1);
  const short = { ...deck, cards: deck.cards.slice(0, -1) };
  expect(admitHumanEvidence(corpus([short]), catalog).excluded[0]!.reasons[0]!.code).toBe('invalid-deck');
  const duplicate = { ...deck, cards: [...deck.cards, { name: names[0], count: 1 }] };
  expect(
    admitHumanEvidence(corpus([duplicate]), catalog).excluded[0]!.reasons.some(
      (r) => r.code === 'duplicate-card',
    ),
  ).toBe(true);
});

it('does not call an empty or excluded-only corpus a validated benchmark', () => {
  expect(admitHumanEvidence(corpus([]), catalog).counts).toEqual({
    tuning: 0,
    holdout: 0,
    independentSessions: 0,
  });
});

it('preserves content-identifying query parameters but rejects tracking-only split changes', () => {
  const first = { ...pick, source: { ...source, url: 'https://example.org/watch?v=one' } };
  const second = {
    ...pick,
    id: 'second',
    split: 'tuning',
    source: { ...source, session: 'second', url: 'https://example.org/watch?v=two' },
  };
  expect(admitHumanEvidence(corpus([first, second]), catalog).counts.independentSessions).toBe(2);
  const tracked = {
    ...second,
    source: { ...second.source, url: 'https://example.org/watch?v=one&utm_source=mail#frame' },
  };
  expect(() => admitHumanEvidence(corpus([first, tracked]), catalog)).toThrow(/split/i);
});

it('reproduces the researched source exclusion instead of claiming expert validation', () => {
  const report = admitHumanEvidence(researchCorpus, catalog);
  expect(report.admitted).toEqual([]);
  expect(report.counts.holdout).toBe(0);
  expect(report.excluded[0]!.reasons).toEqual([
    { code: 'environment-mismatch', detail: 'transfer' },
    { code: 'unknown-card', detail: "Liliana's Triumph" },
    { code: 'unknown-card', detail: 'Meloku the Clouded Mirror' },
    { code: 'unknown-card', detail: 'Prismatic Lens' },
  ]);
});

it('runs the source audit offline and rejects unsupported command options', async () => {
  const cli = fileURLToPath(new URL('../tools/legacy-cube-evidence.ts', import.meta.url));
  const run = promisify(execFile);
  const result = await run(process.execPath, ['--import', 'tsx', cli]);
  const report = JSON.parse(result.stdout) as ReturnType<typeof admitHumanEvidence>;
  expect(report.counts).toEqual({ tuning: 0, holdout: 0, independentSessions: 0 });
  expect(report.excluded).toHaveLength(1);
  const input = fileURLToPath(new URL('../data/legacy-cube-human-evidence-v1.json', import.meta.url));
  const explicit = await run(process.execPath, ['--import', 'tsx', cli, '--corpus', input]);
  expect(JSON.parse(explicit.stdout)).toEqual(report);
  await expect(run(process.execPath, ['--import', 'tsx', cli, '--adopt'])).rejects.toThrow(/Usage:/);
});

it.each(['http://example.org/draft', 'https://user:secret@example.org/draft', 'not a URL'])(
  'rejects unsafe provenance URLs: %s',
  (url) => {
    expect(() => admitHumanEvidence(corpus([{ ...pick, source: { ...source, url } }]), catalog)).toThrow();
  },
);
