import { describe, expect, it } from 'vitest';
import { setOptionLabel } from '../../src/app/SetPicker';
import type { SetPickerRow } from '../../src/app/SetPicker';
import { PrintedFormatIndexSchema } from '../../src/lab/printed-format';
import type { PrintedFormatIndex } from '../../src/lab/printed-format';
import { pickerRows } from '../../src/routes/printed/use-printed-format';

const AVAILABILITY = {
  browse: 'available',
  draft: 'available',
  sealed: 'available',
  play: { status: 'unavailable', reason: 'Full Forge admission is not complete.' },
} as const;

interface CatalogFixture {
  readonly code: string;
  readonly name: string;
  readonly role?: 'supplement';
}

function format(id: string, name: string, catalogs: readonly CatalogFixture[], kind?: 'constructed') {
  return {
    id,
    name,
    availability: AVAILABILITY,
    ...(kind === undefined ? {} : { kind, variant: 'commander' }),
    formatUrl: `formats/${id}/${id}-limited-format-v1.json`,
    catalogs: catalogs.map((catalog) => ({
      ...catalog,
      url: `formats/${id}/${catalog.code.toLowerCase()}-printed-catalog-v1.json`,
    })),
  };
}

function index(formats: readonly ReturnType<typeof format>[]): PrintedFormatIndex {
  return PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats });
}

function labels(rows: readonly SetPickerRow[]): readonly string[] {
  return rows.map((row) => setOptionLabel(row, rows));
}

const INNISTRAD_BLOCK = [
  format('isd', 'Innistrad', [{ code: 'ISD', name: 'Innistrad' }]),
  format('dka', 'Dark Ascension / Innistrad', [
    { code: 'DKA', name: 'Dark Ascension' },
    { code: 'ISD', name: 'Innistrad' },
  ]),
];

const ZENDIKAR_BLOCK = [
  format('zen', 'Zendikar', [{ code: 'ZEN', name: 'Zendikar' }]),
  format('wwk', 'Worldwake / Zendikar', [
    { code: 'WWK', name: 'Worldwake' },
    { code: 'ZEN', name: 'Zendikar' },
  ]),
];

const RAVNICA_BLOCK = [
  format('rav', 'Ravnica: City of Guilds', [{ code: 'RAV', name: 'Ravnica: City of Guilds' }]),
  format('gpt', 'Guildpact / Ravnica: City of Guilds', [
    { code: 'GPT', name: 'Guildpact' },
    { code: 'RAV', name: 'Ravnica: City of Guilds' },
  ]),
  format('dis', 'Dissension / Guildpact / Ravnica: City of Guilds', [
    { code: 'DIS', name: 'Dissension' },
    { code: 'GPT', name: 'Guildpact' },
    { code: 'RAV', name: 'Ravnica: City of Guilds' },
  ]),
];

const RETURN_TO_RAVNICA_BLOCK = [
  format('rtr', 'Return to Ravnica', [{ code: 'RTR', name: 'Return to Ravnica' }]),
  format('gtc', 'Gatecrash', [
    { code: 'GTC', name: 'Gatecrash' },
    { code: 'RTR', name: 'Return to Ravnica' },
  ]),
  format('dgm', "Dragon's Maze / Gatecrash / Return to Ravnica", [
    { code: 'DGM', name: "Dragon's Maze" },
    { code: 'GTC', name: 'Gatecrash' },
    { code: 'RTR', name: 'Return to Ravnica' },
  ]),
];

describe('pickerRows', () => {
  it('lists a one-set format once, never repeating the catalog a sibling format already names', () => {
    const rows = pickerRows(index(INNISTRAD_BLOCK));
    expect(rows.map((row) => row.stem)).toEqual(['printed:isd', 'printed:dka', 'printed:dka:DKA']);
    expect(labels(rows)).toEqual(['Innistrad', 'Dark Ascension / Innistrad', 'Dark Ascension']);
  });

  it('does the same when the shared catalog belongs to the later format instead of the earlier one', () => {
    const rows = pickerRows(index(ZENDIKAR_BLOCK));
    expect(rows.map((row) => row.stem)).toEqual(['printed:zen', 'printed:wwk', 'printed:wwk:WWK']);
    expect(labels(rows)).toEqual(['Zendikar', 'Worldwake / Zendikar', 'Worldwake']);
  });

  it('keeps only the first format’s share of a catalog three formats all carry', () => {
    const rows = pickerRows(index(RAVNICA_BLOCK));
    const stems = rows.map((row) => row.stem);
    expect(stems).toEqual([
      'printed:rav',
      'printed:gpt',
      'printed:gpt:GPT',
      'printed:dis',
      'printed:dis:DIS',
    ]);
    expect(stems).not.toContain('printed:dis:GPT');
    expect(stems).not.toContain('printed:dis:RAV');
    expect(stems).not.toContain('printed:gpt:RAV');
    expect(new Set(labels(rows)).size).toBe(rows.length);
  });

  it('eliminates the cross-format duplicate the picker used to show for a catalog two formats both carry', () => {
    const rows = pickerRows(index(RETURN_TO_RAVNICA_BLOCK));
    const stems = rows.map((row) => row.stem);
    expect(stems).toEqual([
      'printed:rtr',
      'printed:gtc',
      'printed:gtc:GTC',
      'printed:dgm',
      'printed:dgm:DGM',
    ]);
    expect(stems).not.toContain('printed:dgm:GTC');
    expect(stems).not.toContain('printed:dgm:RTR');
    expect(stems).not.toContain('printed:gtc:RTR');
  });

  it('never leaks a stem into a row’s own name', () => {
    for (const block of [INNISTRAD_BLOCK, ZENDIKAR_BLOCK, RAVNICA_BLOCK, RETURN_TO_RAVNICA_BLOCK]) {
      for (const row of pickerRows(index(block))) {
        expect(row.name).not.toContain('printed:');
      }
    }
  });

  it('never emits a row for a supplement catalog no product opens', () => {
    const rows = pickerRows(
      index([
        format('akh-hou', 'Amonkhet / Hour of Devastation', [
          { code: 'AKH', name: 'Amonkhet' },
          { code: 'HOU', name: 'Hour of Devastation' },
          { code: 'MP2', name: 'Amonkhet Invocations', role: 'supplement' },
        ]),
      ]),
    );
    expect(rows.map((row) => row.stem)).toEqual([
      'printed:akh-hou',
      'printed:akh-hou:AKH',
      'printed:akh-hou:HOU',
    ]);
  });

  it('lists no row at all for a constructed format', () => {
    const scd = format(
      'scd',
      'Starter Commander Decks 2022',
      [{ code: 'SCD', name: 'Starter Commander Decks 2022' }],
      'constructed',
    );
    expect(pickerRows(index([scd]))).toEqual([]);
  });

  it('still shows one identical label for a format named after its own headline catalog, same as the real gtc/bng/jou — a gap flagged on mtg-xa694o, not resolved here', () => {
    const rows = pickerRows(index(RETURN_TO_RAVNICA_BLOCK));
    const gatecrash = rows.filter((row) => row.stem === 'printed:gtc' || row.stem === 'printed:gtc:GTC');
    expect(gatecrash.map((row) => row.name)).toEqual(['Gatecrash', 'Gatecrash']);
    expect(labels(gatecrash)).toEqual(['Gatecrash — Magic set', 'Gatecrash — Magic set']);
  });
});
