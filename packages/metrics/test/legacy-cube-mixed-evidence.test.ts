import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import research from '../data/legacy-cube-human-evidence-v1.json';
import heldOutDecks from '../data/legacy-cube-transfer-holdout-decks-v1.json';
import { auditMixedEvidence } from '../src/legacy-cube-calibration/mixed-evidence';
import { admitHumanEvidence } from '../src/legacy-cube-calibration/human-evidence';

const catalog = parsePrintedCardCatalog(catalogJson);
// Deliberately synthetic harness labels, not independent strategic evidence.
const fixture = {
  ...research.cases[0]!,
  id: 'fixture',
  observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15).map((c) => c.correctedName) }],
  preference: { mode: 'flexible', acceptable: [catalog.cards[0]!.correctedName] },
};
const corpus = (cases: readonly unknown[]) => ({ ...research, cases });

it('retains the original adjacent human holdout deck and keeps its quality unmeasured', () => {
  const report = auditMixedEvidence(heldOutDecks, catalog, 'holdout');
  const original = heldOutDecks.cases[0]!;
  const row = report.cases[0]!;
  expect(original.cards.reduce((count, card) => count + card.count, 0)).toBe(40);
  expect(row.original).toEqual(original);
  expect(row.lane).toBe('human-transfer');
  expect(row.overlap).toEqual({
    referencedNames: 27,
    matchedNames: 19,
    missingNames: [
      'Ashen Rider',
      'Phyrexian Rager',
      'Spell Pierce',
      'Vampiric Tutor',
      'Demonic Tutor',
      'Time Walk',
      'Chrome Mox',
      'Skullclamp',
    ],
  });
  expect(row.replay).toBeNull();
  expect(row.unmeasured).toContain('deck-quality');
  expect(report.strictHuman.admitted).toEqual([]);
  expect(report.adoptionEligible).toBe(false);
});

it('keeps adjacent human tuning and holdout sources distinct', () => {
  const combined = corpus([...research.cases, ...heldOutDecks.cases]);
  expect(auditMixedEvidence(combined, catalog).cases).toHaveLength(combined.cases.length);
  const heldOut = heldOutDecks.cases[0]!;
  expect(() =>
    auditMixedEvidence(
      corpus([
        ...research.cases,
        { ...heldOut, source: { ...heldOut.source, url: research.cases[0]!.source.url } },
      ]),
      catalog,
    ),
  ).toThrow(/crosses splits/);
});

it('exposes the mixed audit through the read-only CLI with strict option validation', async () => {
  const cli = fileURLToPath(new URL('../tools/legacy-cube-evidence.ts', import.meta.url));
  const run = promisify(execFile);
  const invoke = (...args: string[]) => run(process.execPath, ['--import', 'tsx', cli, ...args]);
  const result = await invoke('--report', 'mixed');
  expect(JSON.parse(result.stdout)).toEqual(auditMixedEvidence(research, catalog));
  await expect(invoke('--report', 'invented')).rejects.toThrow(/Usage:/);
  await expect(invoke('--report', 'mixed', '--report', 'mixed')).rejects.toThrow(/Usage:/);
});

it('preserves partial human transfer evidence without replacing absent cards or labels', () => {
  const report = auditMixedEvidence(research, catalog, 'tuning');
  const row = report.cases[0]!;
  expect(row.original).toEqual(research.cases[0]);
  expect(row.lane).toBe('human-transfer');
  expect(row.overlap).toMatchObject({ referencedNames: 15, matchedNames: 12 });
  expect(row.overlap.missingNames).toEqual([
    "Liliana's Triumph",
    'Meloku the Clouded Mirror',
    'Prismatic Lens',
  ]);
  expect(row.replay).toBeNull();
  expect(row.contextReview).toBe('required');
  expect(report.adoptionEligible).toBe(false);
  expect(report.strictHuman.counts.tuning).toBe(0);
});

it('replays fully overlapping transfer picks but never promotes them to matched human evidence', () => {
  const input = corpus([fixture]);
  const report = auditMixedEvidence(input, catalog, 'tuning');
  expect(report.cases[0]!.replay?.picks).toHaveLength(1);
  expect(report.cases[0]!.replay?.picks[0]!.structuralAudit.passed).toBe(true);
  expect(report.cases[0]!.contextReview).toBe('required');
  expect(report.strictHuman).toEqual(admitHumanEvidence(input, catalog, 'tuning'));
  expect(auditMixedEvidence(input, catalog, 'tuning')).toEqual(report);
});

it('keeps model and synthetic origins separate even for exactly matching cards', () => {
  for (const origin of ['model', 'synthetic']) {
    const report = auditMixedEvidence(
      corpus([{ ...fixture, source: { ...fixture.source, origin, environment: 'matched' } }]),
      catalog,
    );
    expect(report.cases[0]!.lane).toBe(origin);
    expect(report.strictHuman.admitted).toEqual([]);
    expect(report.cases[0]!.replay?.picks).toHaveLength(1);
    expect(report.adoptionEligible).toBe(false);
  }
});

it('does not replay malformed transcripts, missing choices, or unknown environments', () => {
  for (const change of [
    { observations: [{ ...fixture.observations[0]!, pickNumber: 7 }] },
    { preference: { mode: 'flexible', acceptable: [catalog.cards[20]!.correctedName] } },
    { source: { ...fixture.source, environment: 'unknown' } },
  ]) {
    expect(auditMixedEvidence(corpus([{ ...fixture, ...change }]), catalog).cases[0]!.replay).toBeNull();
  }
});

it('enforces source/session separation and required split even on nonhuman evidence', () => {
  const model = { ...fixture, source: { ...fixture.source, origin: 'model' } };
  expect(() =>
    auditMixedEvidence(corpus([model, { ...model, id: 'other', split: 'holdout' }]), catalog),
  ).toThrow(/crosses splits/);
  expect(() => auditMixedEvidence(corpus([model]), catalog, 'holdout')).toThrow(/holdout-only/);
});

it('reports finished decks without interpreting membership as quality', () => {
  const deck = {
    id: 'deck',
    split: 'tuning',
    source: fixture.source,
    kind: 'deck',
    cards: [
      ...catalog.cards.slice(0, 23).map((c) => ({ name: c.correctedName, count: 1 })),
      { name: 'Island', count: 17 },
    ],
  };
  const row = auditMixedEvidence(corpus([deck]), catalog).cases[0]!;
  expect(row.replay).toBeNull();
  expect(row.original).toEqual(deck);
  expect(row.unmeasured).toContain('deck-quality');
});
