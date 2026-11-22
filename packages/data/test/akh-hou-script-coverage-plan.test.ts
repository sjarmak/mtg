import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PrintedScriptCoveragePlanSchema, parsePrintedCardCatalog } from '@mtg/printed-card';
import plan from '../data/akh-hou/akh-hou-script-coverage-plan-v1.json';

it('binds every reviewed exert requirement to executable controller receipts', () => {
  const parsed = PrintedScriptCoveragePlanSchema.parse(plan);
  const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
    parsePrintedCardCatalog(
      JSON.parse(
        readFileSync(new URL(`../data/akh-hou/${code}-printed-catalog-v1.json`, import.meta.url), 'utf8'),
      ),
    ),
  );
  expect(catalogs.flatMap((catalog) => catalog.cards)).toHaveLength(550);
  expect(parsed.scripts).toHaveLength(3);
  for (const review of parsed.scripts) {
    const cards = catalogs
      .flatMap((catalog) => catalog.cards)
      .filter((card) => card.forgeScript === review.sourceScript.path);
    expect(cards.length).toBeGreaterThan(0);
    expect(new Set(cards.map((card) => card.forgeScriptSha256))).toEqual(
      new Set([review.sourceScript.sha256]),
    );
    expect(review.review).toBe('partial');
    expect(review.obligations.find((obligation) => obligation.id === 'cast-and-characteristics')?.proof).toBe(
      'source',
    );
  }
  const walker = parsed.scripts.find((review) => review.sourceScript.path === 'g/gust_walker.txt')!;
  expect(walker.obligations.find((obligation) => obligation.id === 'flying-and-toughness')).toMatchObject({
    proof: 'scenario',
    requiredControllers: ['local', 'engine'],
    claims: [{ controller: 'local' }, { controller: 'engine' }],
  });
  const glory = parsed.scripts.find((review) => review.sourceScript.path === 'g/glorybringer.txt')!;
  expect(
    glory.obligations.find((obligation) => obligation.id === 'four-damage-and-target-restrictions'),
  ).toMatchObject({
    proof: 'scenario',
    requiredControllers: ['local', 'engine'],
    claims: [{ controller: 'local' }, { controller: 'engine' }],
  });
  const crasher = parsed.scripts.find((review) => review.sourceScript.path === 'a/ahn_crop_crasher.txt')!;
  const expiration = crasher.obligations.find((obligation) => obligation.id === 'restriction-expiration');
  expect(expiration?.proof).toBe('scenario');
  if (expiration?.proof !== 'scenario') throw new Error('Missing scenario obligation');
  expect(expiration.requiredControllers).toEqual(['local']);
  expect(
    crasher.obligations.find((obligation) => obligation.id === 'target-validity-and-zone-change-cleanup'),
  ).toMatchObject({
    proof: 'scenario',
    requiredControllers: ['local', 'engine'],
    claims: [{ controller: 'local' }, { controller: 'engine' }],
  });
  expect(
    parsed.scripts.flatMap((review) =>
      review.obligations.filter(
        (obligation) => obligation.proof === 'scenario' && obligation.claims.length === 0,
      ),
    ),
  ).toEqual([]);
});
