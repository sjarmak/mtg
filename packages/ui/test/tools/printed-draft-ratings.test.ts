import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ForgeDraftRankingReader } from '@mtg/forge-export';
import { loadPrintedFormat } from '../../src/lab/printed-format';
import {
  buildInstalledPrintedDraftRatings,
  buildPrintedDraftRatings,
} from '../../tools/printed-draft-ratings';
import { stagePrintedFormats } from '../../tools/stage-printed-formats';
import { NO_RELEASE_DATES } from '../../tools/printed-release-dates';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const source = {
  id: 'isd',
  directory: resolve('packages/data/data/isd'),
  formatFile: 'isd-limited-format-v1.json',
  displayMetadataFile: 'isd-display-metadata-v1.json',
  availability: {
    browse: 'available' as const,
    draft: 'available' as const,
    sealed: 'available' as const,
    play: { status: 'unavailable' as const, reason: 'Full Forge admission is incomplete.' },
  },
  catalogs: [{ code: 'ISD', file: 'isd-printed-catalog-v1.json' }],
};

const constructedSource = {
  id: 'scd',
  directory: resolve('packages/data/data/scd'),
  formatFile: 'scd-constructed-format-v1.json',
  displayMetadataFile: 'scd-display-metadata-v1.json',
  availability: {
    browse: 'available' as const,
    draft: 'unavailable' as const,
    sealed: 'unavailable' as const,
    play: { status: 'unavailable' as const, reason: 'Commander play is not admitted yet.' },
  },
  catalogs: [{ code: 'SCD', file: 'scd-printed-catalog-v1.json' }],
};

function reader(rank: (name: string) => number | null): ForgeDraftRankingReader {
  return {
    forgeVersion: '2.0.14',
    fingerprint: 'c'.repeat(64),
    read: async (_setCode, names) => names.map(rank),
    dispose: () => undefined,
  };
}

it('stages and reloads a complete Forge-ranked Innistrad policy', async () => {
  const built = await buildPrintedDraftRatings(
    [source],
    reader((name) => (/^(?:Plains|Island|Swamp|Mountain|Forest)$/u.test(name) ? null : 0.25)),
  );
  expect(built.messages).toEqual(['isd: Forge-ranked deck-aware draft policy (264 cards)']);
  const root = mkdtempSync(join(tmpdir(), 'printed-ratings-stage-'));
  roots.push(root);
  const index = await stagePrintedFormats([source], root, {
    releaseDateOf: NO_RELEASE_DATES,
    draftRatings: built.artifacts,
  });
  expect(index.formats[0]!.draftRatingsUrl).toMatch(/^formats\/isd\/draft-ratings-[a-f0-9]{64}\.json$/u);
  const ratingsUrl = index.formats[0]!.draftRatingsUrl!;
  const stagedBody = readFileSync(join(root, ratingsUrl), 'utf8');
  expect(ratingsUrl).toContain(createHash('sha256').update(stagedBody).digest('hex'));
  const loaded = await loadPrintedFormat(index.formats[0]!, async (url) =>
    JSON.parse(readFileSync(join(root, url), 'utf8')),
  );
  expect(loaded.draftRatings?.catalogs[0]?.cards).toHaveLength(264);
  expect(loaded.draftRatings?.catalogs[0]?.cards.find((card) => (card.quality ?? 0) > 0)?.quality).toBe(3.75);
});

it('withholds an incomplete Forge artifact and names the first missing nonbasic', async () => {
  const built = await buildPrintedDraftRatings(
    [source],
    reader(() => null),
  );
  expect(built.artifacts.size).toBe(0);
  expect(built.messages[0]).toMatch(/no complete Forge ranking.*Abbey Griffin/);
});

it('does not call a ranking incomplete for printings no booster sheet can deal', async () => {
  const xln = {
    id: 'xln',
    directory: resolve('packages/data/data/xln'),
    formatFile: 'xln-limited-format-v1.json',
    displayMetadataFile: 'xln-display-metadata-v1.json',
    availability: source.availability,
    catalogs: [{ code: 'XLN', file: 'xln-printed-catalog-v1.json' }],
  };
  const undrafted = new Set(['Jace, Ingenious Mind-Mage', 'Stone Quarry', "Huatli's Snubhorn"]);
  const built = await buildPrintedDraftRatings(
    [xln],
    reader((name) =>
      /^(?:Plains|Island|Swamp|Mountain|Forest)$/u.test(name) || undrafted.has(name) ? null : 0.25,
    ),
  );
  expect(built.messages).toEqual(['xln: Forge-ranked deck-aware draft policy (289 cards)']);
  const drafted = await buildPrintedDraftRatings(
    [xln],
    reader((name) => (/^(?:Plains|Island|Swamp|Mountain|Forest|Opt)$/u.test(name) ? null : 0.25)),
  );
  expect(drafted.artifacts.size).toBe(0);
  expect(drafted.messages[0]).toMatch(/no complete Forge ranking.*XLN:Opt/);
});

it('keeps the launcher usable when an installed Forge ranking companion cannot initialize', async () => {
  const built = await buildInstalledPrintedDraftRatings([source], () => {
    throw new Error('javac is unavailable');
  });
  expect(built.artifacts.size).toBe(0);
  expect(built.messages).toEqual(['isd: Forge draft rankings unavailable (javac is unavailable)']);
});

it('disposes an initialized Forge ranking reader after a successful build', async () => {
  let disposed = false;
  const built = await buildInstalledPrintedDraftRatings([source], () => ({
    ...reader((name) => (/^(?:Plains|Island|Swamp|Mountain|Forest)$/u.test(name) ? null : 0.25)),
    dispose: () => {
      disposed = true;
    },
  }));
  expect(built.artifacts.has('isd')).toBe(true);
  expect(disposed).toBe(true);
});

it('withholds ratings and disposes the reader when Forge rejects a ranking read', async () => {
  let disposed = false;
  const built = await buildInstalledPrintedDraftRatings([source], () => ({
    forgeVersion: '2.0.14',
    fingerprint: 'c'.repeat(64),
    read: async () => {
      throw new Error('ranking process exited');
    },
    dispose: () => {
      disposed = true;
    },
  }));
  expect(built.artifacts.size).toBe(0);
  expect(built.messages).toEqual(['isd: Forge ranking read failed (ranking process exited)']);
  expect(disposed).toBe(true);
});

it('stages a constructed format beside a limited one without ranking it', async () => {
  const built = await buildPrintedDraftRatings(
    [source, constructedSource],
    reader(() => 0.5),
  );
  expect([...built.artifacts.keys()]).toEqual(['isd']);
  expect(built.messages).toContain('scd: fixed decks, no draft to rank');
});

it('names a constructed format when no Forge ranking companion can initialize', async () => {
  const built = await buildInstalledPrintedDraftRatings([constructedSource], () => {
    throw new Error('no Forge here');
  });
  expect(built.artifacts.size).toBe(0);
  expect(built.messages).toEqual(['scd: Forge draft rankings unavailable (no Forge here)']);
});

const akhHou = {
  id: 'akh-hou',
  directory: resolve('packages/data/data/akh-hou'),
  formatFile: 'akh-hou-limited-format-v1.json',
  displayMetadataFile: 'akh-hou-display-metadata-v1.json',
  availability: source.availability,
  catalogs: ['AKH', 'HOU', 'MP2'].map((code) => ({
    code,
    file: `${code.toLowerCase()}-printed-catalog-v1.json`,
  })),
};

it('stages a format whose booster sheets Forge ranks in full even though a masterpiece sheet has no ranking file at all', async () => {
  const built = await buildPrintedDraftRatings([akhHou], {
    forgeVersion: '2.0.14',
    fingerprint: 'c'.repeat(64),
    read: async (code, names) =>
      code === 'MP2'
        ? names.map(() => null)
        : names.map((name) => (/^(?:Plains|Island|Swamp|Mountain|Forest)$/u.test(name) ? null : 0.25)),
    dispose: () => undefined,
  });
  expect(built.artifacts.size).toBe(1);
  expect(built.messages[0]).toMatch(
    /^akh-hou: Forge-ranked deck-aware draft policy \(\d+ cards; MP2 unranked, 54 cards Forge ships no ranking list for\)$/u,
  );
  const artifact = built.artifacts.get('akh-hou')!;
  const mp2 = artifact.catalogs.find((catalog) => catalog.code === 'MP2')!;
  expect(mp2.cards.every((card) => card.quality === null)).toBe(true);
  const akh = artifact.catalogs.find((catalog) => catalog.code === 'AKH')!;
  expect(akh.cards.some((card) => card.quality !== null)).toBe(true);
});

it('still withholds a catalog Forge ranks only some of, even beside a catalog it ranks none of', async () => {
  const built = await buildPrintedDraftRatings(
    [akhHou],
    reader((name) =>
      /^(?:Plains|Island|Swamp|Mountain|Forest)$/u.test(name) || name === 'Gideon of the Trials'
        ? null
        : 0.25,
    ),
  );
  expect(built.artifacts.size).toBe(0);
  expect(built.messages[0]).toMatch(/no complete Forge ranking.*AKH:Gideon of the Trials/);
});
