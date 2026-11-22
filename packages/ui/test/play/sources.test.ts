import { describe, expect, it } from 'vitest';
import type { PrintedFormatRow } from '../../src/lab/printed-format';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';
import {
  CUBE_SOURCE_NAME,
  movedCommanderSource,
  orderPrintedFormats,
  playSources,
  resolvePlaySource,
} from '../../src/routes/play/sources';
import type { StagedSources } from '../../src/routes/play/sources';

const READY = {
  browse: 'available',
  draft: 'available',
  sealed: 'available',
  play: { status: 'supported', reason: 'Admitted.' },
} as const;

function printed(id: string, name: string, over: Partial<PrintedFormatRow> = {}): PrintedFormatRow {
  return {
    id,
    name,
    availability: READY,
    formatUrl: `formats/${id}/${id}-limited-format-v1.json`,
    catalogs: [{ code: id.toUpperCase().replace(/-/gu, ''), url: `formats/${id}/${id}-catalog.json` }],
    ...over,
  } as PrintedFormatRow;
}

const staged: StagedSources = {
  kernel: [
    { stem: 'xmp', name: 'the flagship set', origin: 'custom' },
    { stem: 'm11', name: 'Magic 2011', origin: 'official' },
  ],
  printed: [
    printed('akh-hou', 'Amonkhet / Hour of Devastation', { releaseDate: '2017-04-28' }),
    printed('ktk', 'Khans of Tarkir', {
      releaseDate: '2014-09-26',
      constructedFormatUrl: 'formats/ktk/ktk-constructed-format-v1.json',
      constructedAdmissionUrl: 'formats/ktk/ktk-constructed-admission-v1.json',
    }),
    printed('scd', 'Starter Commander Decks 2022', {
      kind: 'constructed',
      variant: 'commander',
      availability: { ...READY, draft: 'unavailable', sealed: 'unavailable' },
    }),
  ],
  cube: true,
};

const withMomir: StagedSources = {
  ...staged,
  printed: [
    ...staged.printed,
    printed('momir-basic', 'Momir Basic', {
      kind: 'constructed',
      variant: 'momir',
      availability: { ...READY, draft: 'unavailable', sealed: 'unavailable' },
    }),
  ],
};

const stems = (sub: 'constructed' | 'draft' | 'sealed' | 'commander'): readonly string[] =>
  playSources(sub, staged).map((source) => source.stem);

describe('what a Play section can be played with', () => {
  it('plays generated sets and limited formats that carry constructed decks on Constructed', () => {
    expect(stems('constructed')).toEqual(['xmp', 'printed:ktk']);
    expect(playSources('constructed', staged).at(-1)).toEqual({
      kind: 'printed',
      stem: 'printed:ktk',
      name: 'Khans of Tarkir',
    });
  });

  it.each(['constructed', 'draft', 'sealed'] as const)(
    'never lists a kernel build of a real printing on %s, whatever printed rows are staged',
    (sub) => {
      expect(stems(sub)).not.toContain('m11');
      expect(playSources(sub, { ...staged, printed: [], cube: false }).map((source) => source.stem)).toEqual([
        'xmp',
      ]);
    },
  );

  it.each(['constructed', 'draft', 'sealed'] as const)('lists every generated set first on %s', (sub) => {
    const twoCustom = {
      ...staged,
      kernel: [
        ...staged.kernel,
        { stem: 'tideglass-reach', name: 'Tideglass Reach', origin: 'custom' as const },
      ],
    };
    expect(playSources(sub, twoCustom).slice(0, 2)).toEqual([
      { kind: 'kernel', stem: 'xmp', name: 'the flagship set', origin: 'custom' },
      { kind: 'kernel', stem: 'tideglass-reach', name: 'Tideglass Reach', origin: 'custom' },
    ]);
  });

  it('adds every printed format that deals packs, and the cube, to Draft', () => {
    expect(stems('draft')).toEqual(['xmp', 'printed:akh-hou', 'printed:ktk', LEGACY_CUBE_FORMAT]);
    expect(playSources('draft', staged).at(-1)?.name).toBe(CUBE_SOURCE_NAME);
  });

  it('opens the same printed formats on Sealed and never the cube, which deals no pool', () => {
    expect(stems('sealed')).toEqual(['xmp', 'printed:akh-hou', 'printed:ktk']);
  });

  it('plays the printed constructed formats alone on Commander', () => {
    expect(stems('commander')).toEqual(['printed:scd']);
    expect(playSources('commander', staged)[0]).toEqual({
      kind: 'printed',
      stem: 'printed:scd',
      name: 'Starter Commander Decks 2022',
    });
  });

  it('lists a Commander format that can be played ahead of one that can only be read', () => {
    const browseOnly = printed('commander-precons', 'Commander Preconstructed Decks', {
      kind: 'constructed',
      variant: 'commander',
      availability: {
        ...READY,
        draft: 'unavailable',
        sealed: 'unavailable',
        play: { status: 'unavailable', reason: 'Not admitted.' },
      },
    });
    const sources = playSources('commander', { ...staged, printed: [browseOnly, ...staged.printed] });
    expect(sources.map((source) => source.stem)).toEqual(['printed:scd', 'printed:commander-precons']);
    expect(sources[1]).toEqual({
      kind: 'printed',
      stem: 'printed:commander-precons',
      name: 'Commander Preconstructed Decks',
    });
    expect(resolvePlaySource({}, sources, null)?.stem).toBe('printed:scd');
    expect(resolvePlaySource({ source: 'printed:commander-precons' }, sources, null)?.stem).toBe(
      'printed:commander-precons',
    );
  });

  it('plays a Momir-variant constructed row on Constructed, never on Commander', () => {
    expect(playSources('commander', withMomir).map((source) => source.stem)).toEqual(['printed:scd']);
    expect(playSources('constructed', withMomir).map((source) => source.stem)).toEqual([
      'xmp',
      'printed:ktk',
      'printed:momir-basic',
    ]);
  });

  it('keeps a product the format cannot deal and states why it is unavailable', () => {
    const closed = {
      ...staged,
      printed: [
        printed('akh-hou', 'Amonkhet / Hour of Devastation', {
          availability: { ...READY, draft: 'unavailable' },
        }),
      ],
    };
    expect(playSources('draft', closed)).toContainEqual({
      kind: 'printed',
      stem: 'printed:akh-hou',
      name: 'Amonkhet / Hour of Devastation',
      unavailableReason: 'Draft is not available for this printed format.',
    });
    expect(playSources('sealed', closed).map((source) => source.stem)).toEqual(['xmp', 'printed:akh-hou']);
  });

  it('lists a format once however many sets it collates', () => {
    const both = playSources('draft', staged).filter((source) => source.stem.startsWith('printed:'));
    expect(both).toHaveLength(2);
  });
});

describe('the order the printed formats are listed in', () => {
  const rows = [
    printed('undated', 'Undated format', { releaseDate: undefined }),
    printed('old', 'Alpha', { releaseDate: '1993-08-05' }),
    printed('new', 'Zebra', { releaseDate: '2024-11-15' }),
    printed('tie-b', 'Beta', { releaseDate: '2024-11-15' }),
    printed('tie-a', 'Aardvark', { releaseDate: '2024-11-15' }),
    printed('mid', 'Middle', { releaseDate: '2010-07-16' }),
    printed('also-undated', 'Also undated', { releaseDate: undefined }),
  ];

  it('is newest release first, same date by name, undated last', () => {
    expect(orderPrintedFormats(rows).map((row) => row.id)).toEqual([
      'tie-a',
      'tie-b',
      'new',
      'mid',
      'old',
      'also-undated',
      'undated',
    ]);
  });

  it.each(['draft', 'sealed'] as const)('is the order %s lists them in, after the generated sets', (sub) => {
    expect(playSources(sub, { ...staged, printed: rows, cube: false }).map((source) => source.stem)).toEqual([
      'xmp',
      'printed:tie-a',
      'printed:tie-b',
      'printed:new',
      'printed:mid',
      'printed:old',
      'printed:also-undated',
      'printed:undated',
    ]);
  });

  it('orders Constructed and Commander the same way over the rows they keep', () => {
    const constructed = rows.map((row) =>
      printed(row.id, row.name, {
        ...(row.releaseDate === undefined ? {} : { releaseDate: row.releaseDate }),
        constructedFormatUrl: `formats/${row.id}/constructed.json`,
      }),
    );
    expect(
      playSources('constructed', { ...staged, printed: constructed }).map((source) => source.stem),
    ).toEqual([
      'xmp',
      'printed:tie-a',
      'printed:tie-b',
      'printed:new',
      'printed:mid',
      'printed:old',
      'printed:also-undated',
      'printed:undated',
    ]);
    const commander = rows.map((row) =>
      printed(row.id, row.name, {
        ...(row.releaseDate === undefined ? {} : { releaseDate: row.releaseDate }),
        kind: 'constructed',
      }),
    );
    expect(playSources('commander', { ...staged, printed: commander }).map((source) => source.stem)).toEqual([
      'printed:tie-a',
      'printed:tie-b',
      'printed:new',
      'printed:mid',
      'printed:old',
      'printed:also-undated',
      'printed:undated',
    ]);
  });

  it('leaves the staged rows as they were', () => {
    const before = rows.map((row) => row.id);
    orderPrintedFormats(rows);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe('which of them a link lands on', () => {
  const sources = playSources('draft', staged);

  it('takes the stem the hash names', () => {
    expect(resolvePlaySource({ source: 'printed:ktk' }, sources, 'xmp')?.stem).toBe('printed:ktk');
  });

  it('reads the older cube spelling as the same answer', () => {
    expect(resolvePlaySource({ cube: LEGACY_CUBE_FORMAT }, sources, 'xmp')?.stem).toBe(LEGACY_CUBE_FORMAT);
  });

  it('reads a Cards link into one set of a format as that format', () => {
    expect(resolvePlaySource({ source: 'printed:akh-hou:HOU' }, sources, 'xmp')?.stem).toBe(
      'printed:akh-hou',
    );
  });

  it('falls to the launcher’s own set when the hash names something this section cannot play', () => {
    expect(resolvePlaySource({ source: 'printed:scd' }, sources, 'xmp')?.stem).toBe('xmp');
  });

  it('falls back from a link to a kernel build of a real printing, which no section lists', () => {
    expect(resolvePlaySource({ source: 'm11' }, sources, 'xmp')?.stem).toBe('xmp');
    expect(resolvePlaySource({ source: 'm11' }, sources, 'm11')?.stem).toBe('xmp');
  });

  it('falls to the head of the list when the launcher’s set is not listed either', () => {
    expect(resolvePlaySource({}, playSources('commander', staged), 'm11')?.stem).toBe('printed:scd');
  });

  it('keeps an unavailable deep link selected so the page can explain its refusal', () => {
    const unavailable = playSources('draft', {
      ...staged,
      printed: [
        printed('no-draft', 'Unavailable format', {
          availability: { ...READY, draft: 'unavailable' },
        }),
      ],
    });
    expect(resolvePlaySource({ source: 'printed:no-draft' }, unavailable, 'xmp')?.stem).toBe(
      'printed:no-draft',
    );
  });

  it('answers nothing at all for a section with nothing staged', () => {
    expect(resolvePlaySource({ source: 'xmp' }, [], 'xmp')).toBeNull();
  });
});

describe('where a Commander link to a moved printed row now belongs', () => {
  it('sends a Momir-variant source to Constructed', () => {
    expect(movedCommanderSource({ source: 'printed:momir-basic' }, withMomir.printed)).toBe('constructed');
  });

  it('leaves a genuine Commander source alone', () => {
    expect(movedCommanderSource({ source: 'printed:scd' }, withMomir.printed)).toBeNull();
  });

  it('leaves a Cards-tab set address for a Momir-variant source alone too', () => {
    expect(movedCommanderSource({ source: 'printed:momir-basic:M11' }, withMomir.printed)).toBe(
      'constructed',
    );
  });

  it('answers nothing for a source naming no staged printed row', () => {
    expect(movedCommanderSource({ source: 'printed:unknown' }, withMomir.printed)).toBeNull();
  });

  it('answers nothing when the hash names no source at all', () => {
    expect(movedCommanderSource({}, withMomir.printed)).toBeNull();
  });
});
