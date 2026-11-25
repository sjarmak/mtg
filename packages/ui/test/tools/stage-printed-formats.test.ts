import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stagePrintedFormats, withholdPrintedPlay } from '../../tools/stage-printed-formats';
import { releaseDateLookup } from '../../tools/printed-release-dates';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { loadPrintedFormat } from '../../src/lab/printed-format';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const source = {
  id: 'akh-hou',
  directory: resolve('packages/data/data/akh-hou'),
  formatFile: 'akh-hou-limited-format-v1.json',
  displayMetadataFile: 'akh-hou-display-metadata-v1.json',
  availability: {
    browse: 'available' as const,
    draft: 'available' as const,
    sealed: 'available' as const,
    play: { status: 'unavailable' as const, reason: 'Full Forge admission is not complete.' },
  },
  catalogs: ['AKH', 'HOU', 'MP2'].map((code) => ({
    code,
    file: `${code.toLowerCase()}-printed-catalog-v1.json`,
  })),
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
    play: { status: 'unavailable' as const, reason: 'Commander play is not yet admitted.' },
  },
  catalogs: [{ code: 'SCD', name: 'Starter Commander Decks 2022', file: 'scd-printed-catalog-v1.json' }],
};
const ktkSource = () => {
  const directory = temporary();
  const data = resolve('packages/data/data/ktk');
  for (const file of ['ktk-limited-format-v1.json', 'ktk-printed-catalog-v1.json']) {
    cpSync(join(data, file), join(directory, file));
  }
  cpSync(
    resolve('packages/ui/test/fixtures/ktk-constructed-format-v1.json'),
    join(directory, 'ktk-constructed-format-v1.json'),
  );
  return {
    id: 'ktk',
    directory,
    admissionDirectory: join(data, 'play-admission'),
    formatFile: 'ktk-limited-format-v1.json',
    constructedFormatFile: 'ktk-constructed-format-v1.json',
    availability: {
      browse: 'available' as const,
      draft: 'available' as const,
      sealed: 'available' as const,
      play: { status: 'supported' as const, reason: 'Verified admission is installed.' },
    },
    catalogs: [{ code: 'KTK', file: 'ktk-printed-catalog-v1.json' }],
  };
};
const staging = {
  releaseDateOf: releaseDateLookup({ AKH: '2017-04-28', HOU: '2017-07-14', MP2: null, KTK: '2014-09-26' }),
};
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'printed-staging-'));
  roots.push(root);
  return root;
};

describe('printed format staging', () => {
  it('publishes a checked content-addressed bundle the browser reader can consume', async () => {
    const root = temporary();
    const index = await stagePrintedFormats([source], root, staging);
    expect(index.schemaVersion).toBe(2);
    expect(index.formats[0]!.availability.play.status).toBe('unavailable');
    expect(JSON.parse(readFileSync(join(root, 'formats/index.json'), 'utf8'))).toEqual(index);
    const row = index.formats[0]!;
    expect(row.kind).toBe('limited');
    expect(row.formatUrl).toMatch(/^formats\/akh-hou\/[a-f0-9]{64}\//);
    // The role is read off the products: AKH and HOU packs open, MP2 rides inside them.
    expect(row.catalogs.map((catalog) => [catalog.code, catalog.role])).toEqual([
      ['AKH', 'product'],
      ['HOU', 'product'],
      ['MP2', 'supplement'],
    ]);
    const loaded = await loadPrintedFormat(row, async (url) =>
      JSON.parse(readFileSync(join(root, url), 'utf8')),
    );
    expect(loaded.prepared.openSealedPool('staged').cards).toHaveLength(84);
    expect(Object.keys(loaded.rarities)).toHaveLength(550);
    const withoutDisplay = await loadPrintedFormat({ ...row, displayMetadataUrl: undefined }, async (url) =>
      JSON.parse(readFileSync(join(root, url), 'utf8')),
    );
    expect(loaded.prepared.fingerprint).toBe(withoutDisplay.prepared.fingerprint);
    expect(loaded.prepared.openSealedPool('staged')).toEqual(
      withoutDisplay.prepared.openSealedPool('staged'),
    );
    expect(await stagePrintedFormats([source], root, staging)).toEqual(index);
  });

  it('stages a constructed format beside a limited one, checked through its own loader', async () => {
    const root = temporary();
    const index = await stagePrintedFormats([source, constructedSource], root, staging);
    expect(index.formats.map((row) => [row.id, row.kind, row.releaseDate])).toEqual([
      ['akh-hou', 'limited', '2017-04-28'],
      ['scd', 'constructed', undefined],
    ]);
    const row = index.formats[1]!;
    expect(row.formatUrl).toMatch(/^formats\/scd\/[a-f0-9]{64}\/scd-constructed-format-v1\.json$/);
    // The one set every deck draws from is the product; nothing rides inside a pack here.
    expect(row.catalogs.map((catalog) => [catalog.code, catalog.role])).toEqual([['SCD', 'product']]);
    const read = async (url: string): Promise<unknown> => JSON.parse(readFileSync(join(root, url), 'utf8'));
    const loaded = await loadPrintedConstructedFormat(row, read);
    expect(loaded.format.decks).toHaveLength(5);
    expect(loaded.printings.size).toBeGreaterThan(300);
    await expect(loadPrintedFormat(row, read)).rejects.toThrow(/constructed format/);
    expect(await stagePrintedFormats([source, constructedSource], root, staging)).toEqual(index);
  });

  it('stages constructed decks on a limited format without changing its limited bundle', async () => {
    const root = temporary();
    const index = await stagePrintedFormats([ktkSource()], root, staging);
    const row = index.formats[0]!;
    expect(row.kind).toBe('limited');
    expect(row.constructedFormatUrl).toMatch(/ktk-constructed-format-v1\.json$/u);
    expect(row.constructedAdmissionUrl).toMatch(/constructed-admission-[a-f0-9]{64}\.json$/u);
    const read = async (url: string): Promise<unknown> => JSON.parse(readFileSync(join(root, url), 'utf8'));
    const limited = await loadPrintedFormat(row, read);
    const constructed = await loadPrintedConstructedFormat(row, read);
    expect(limited.prepared.openSealedPool('staged').cards).toHaveLength(84);
    expect(limited.prepared.openDraftPacks('staged')).toHaveLength(24);
    expect(constructed.format.rules).toEqual({ variant: 'standard', startingLife: 20 });
    expect(constructed.format.decks[0]!.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(60);
  });

  it('refuses a sidecar deck card missing from the limited format admission', async () => {
    const staged = ktkSource();
    const admissionPath = join(staged.admissionDirectory, 'admission.json');
    const admission = JSON.parse(readFileSync(admissionPath, 'utf8')) as {
      cards: { id: string }[];
    };
    const first = JSON.parse(readFileSync(join(staged.directory, staged.constructedFormatFile), 'utf8')) as {
      decks: { cards: { physicalId: string; name: string }[] }[];
    };
    admission.cards = admission.cards.map((card) =>
      card.id === first.decks[0]!.cards[0]!.physicalId ? { ...card, review: 'pending' } : card,
    );
    const admissionDirectory = temporary();
    writeFileSync(join(admissionDirectory, 'admission.json'), JSON.stringify(admission));
    await expect(
      stagePrintedFormats([{ ...staged, admissionDirectory }], temporary(), staging),
    ).rejects.toThrow(/Abzan Battle Priest.*not admitted/u);
  });

  it('stages a format’s token printings beside it and hands them to both loaders', async () => {
    const root = temporary();
    const withTokens = { ...source, tokenPrintingsFile: 'akh-hou-token-printings-v1.json' };
    const constructedWithTokens = { ...constructedSource, tokenPrintingsFile: 'scd-token-printings-v1.json' };
    const index = await stagePrintedFormats([withTokens, constructedWithTokens], root, staging);
    const read = async (url: string): Promise<unknown> => JSON.parse(readFileSync(join(root, url), 'utf8'));
    const [limited, constructed] = index.formats;
    expect(limited?.tokenPrintingsUrl).toMatch(/^formats\/akh-hou\/tokens-[a-f0-9]{64}\.json$/);
    expect(constructed?.tokenPrintingsUrl).toMatch(/^formats\/scd\/tokens-[a-f0-9]{64}\.json$/);
    const loaded = await loadPrintedFormat(limited!, read);
    expect(loaded.tokens.length).toBeGreaterThan(0);
    expect(loaded.tokens.every((token) => token.observedNames.length > 0)).toBe(true);
    const precons = await loadPrintedConstructedFormat(constructed!, read);
    expect(precons.tokens.map((token) => token.name)).toContain('Pegasus');
    const bare = await loadPrintedFormat(index.formats[0]!, read);
    expect(bare.tokens.length).toBe(loaded.tokens.length);
    expect((await loadPrintedFormat({ ...limited!, tokenPrintingsUrl: undefined }, read)).tokens).toEqual([]);
  });

  it('turns Play off for a withheld format only, keeping its draft and sealed', async () => {
    const root = temporary();
    const index = await stagePrintedFormats([ktkSource(), source], root, staging);
    const reason = 'Play is off: the installed admission was built against a different bridge.';
    const next = withholdPrintedPlay(root, index, [{ formatId: 'ktk', reason }]);
    const ktk = next.formats.find((row) => row.id === 'ktk')!;
    expect(ktk.availability).toEqual({
      browse: 'available',
      draft: 'available',
      sealed: 'available',
      play: { status: 'unavailable', reason },
    });
    expect(next.formats.find((row) => row.id === 'akh-hou')).toEqual(
      index.formats.find((row) => row.id === 'akh-hou'),
    );
    expect(JSON.parse(readFileSync(join(root, 'formats/index.json'), 'utf8'))).toEqual(next);
  });

  it('leaves the prior index untouched when the next bundle is invalid', async () => {
    const root = temporary();
    const index = await stagePrintedFormats([source], root, staging);
    const broken = temporary();
    writeFileSync(join(broken, source.formatFile), '{}');
    await expect(stagePrintedFormats([{ ...source, directory: broken }], root, staging)).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(root, 'formats/index.json'), 'utf8'))).toEqual(index);
  });
});
