/**
 * Every installed token printing names a real Forge token script whose facts
 * match, so a surface matching an object by engine name draws the right art.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePrintedTokenPrintings } from '@mtg/printed-card';
import {
  bindTokenPrintings,
  parseForgeTokenScript,
  statedAliasesFor,
  tokenCollectorKey,
} from '../src/printed-card/token-printings';
import type { ForgeTokenScript } from '../src/printed-card/token-printings';
import type { ScryfallCard } from '../src/scryfall/schemas';

const dataRoot = new URL('../data/', import.meta.url);
const INSTALLED = [
  'scd/scd-token-printings-v1.json',
  'som/som-token-printings-v1.json',
  'isd/isd-token-printings-v1.json',
  'mbs/mbs-token-printings-v1.json',
  'roe/roe-token-printings-v1.json',
  'nph/nph-token-printings-v1.json',
  'm12/m12-token-printings-v1.json',
  'm10/m10-token-printings-v1.json',
  'm11/m11-token-printings-v1.json',
  'm13/m13-token-printings-v1.json',
  'dka/dka-token-printings-v1.json',
  'avr/avr-token-printings-v1.json',
  'gtc/gtc-token-printings-v1.json',
  'm15/m15-token-printings-v1.json',
  'm14/m14-token-printings-v1.json',
  'akh-hou/akh-hou-token-printings-v1.json',
  'ths/ths-token-printings-v1.json',
  'jou/jou-token-printings-v1.json',
  'dgm/dgm-token-printings-v1.json',
  'ktk/ktk-token-printings-v1.json',
  'ori/ori-token-printings-v1.json',
  'legacy-cube-2021-token-printings-v1.json',
  'bng/bng-token-printings-v1.json',
  'xln/xln-token-printings-v1.json',
  'kld-aer/kld-aer-token-printings-v1.json',
  'rtr/rtr-token-printings-v1.json',
  'rav/rav-token-printings-v1.json',
  'gpt/gpt-token-printings-v1.json',
  'dis/dis-token-printings-v1.json',
  'lrw/lrw-token-printings-v1.json',
  'wwk/wwk-token-printings-v1.json',
  'commander-precons/commander-precons-token-printings-v1.json',
];
const scriptsDirectory = fileURLToPath(
  new URL('../../../tools/forge/dist/res/tokenscripts/', import.meta.url),
);

function forgeScripts(): Map<string, ForgeTokenScript[]> {
  const byName = new Map<string, ForgeTokenScript[]>();
  for (const file of readdirSync(scriptsDirectory).filter((name) => name.endsWith('.txt'))) {
    const script = parseForgeTokenScript(file, readFileSync(join(scriptsDirectory, file), 'utf8'));
    if (script === undefined) continue;
    byName.set(script.name, [...(byName.get(script.name) ?? []), script]);
  }
  return byName;
}

/**
 * Printings bound by a stated alias rather than by the automatic name-and-type
 * match. Scryfall names Wurmcoil Engine's two tokens "Wurm", typed "Wurm", while
 * both Forge scripts say "Phyrexian Wurm Token", typed "Artifact Creature Phyrexian
 * Wurm" (mtg-bn1ah); Scryfall prints the oldest Living Weapon Germ, TMBS 1, as
 * "Germ", typed "Germ", which Forge creates as "Phyrexian Germ Token", typed
 * "Creature Phyrexian Germ" (mtg-9ggmy). The type-line check below exists to catch
 * drift in the *automatic* match, which these were never subject to, so their
 * physical ids are exempted from it; the name, colors and P/T still have to agree.
 */
const STATED_ALIAS_TYPE_MISMATCH = new Set([
  'tsom-token:0008:3e46e703-2157-41e5-9c21-c17af43e0d3f',
  'tsom-token:0009:ee53b9a0-8e07-404d-87ae-ff8397a0ba29',
  'tmbs-token:0001:760dcba4-c0f1-4843-9c39-393c629aae8e',
]);

describe('installed token printings', () => {
  const scripts = forgeScripts();

  it.each(INSTALLED)('%s binds every token to a Forge script stating the same token', (file) => {
    const parsed = parsePrintedTokenPrintings(JSON.parse(readFileSync(new URL(file, dataRoot), 'utf8')));
    expect(parsed.tokens.length).toBeGreaterThan(0);
    for (const token of parsed.tokens) {
      expect(token.art.status).toBe('available');
      const checkTypes = !STATED_ALIAS_TYPE_MISMATCH.has(token.physicalId);
      for (const observed of token.observedNames) {
        const witnesses = scripts.get(observed) ?? [];
        const same = witnesses.some(
          (script) =>
            script.colors.join('') === token.colors.join('') &&
            script.power === token.power &&
            script.toughness === token.toughness &&
            (!checkTypes ||
              script.types.join(' ') === token.typeLine.replace(/^Token\s+/u, '').replace(/\s+—\s+/u, ' ')),
        );
        expect(same, `${token.name} (${observed})`).toBe(true);
      }
    }
  });
});

describe('installed token printing identity', () => {
  it.each(INSTALLED)('%s keeps the id form its collector numbers derive', (file) => {
    const parsed = parsePrintedTokenPrintings(JSON.parse(readFileSync(new URL(file, dataRoot), 'utf8')));
    for (const token of parsed.tokens) {
      const collector = /^[a-z0-9]+-token:([^:]+):/u.exec(token.physicalId)?.[1];
      expect(collector, token.physicalId).toBeDefined();
      // A plain-integer collector number is zero-padded and is the position. A derived one
      // (`1a`, `t3`) carries its letters and takes its first number as the position.
      const key = tokenCollectorKey(
        /^\d{4}$/u.test(collector ?? '') ? String(Number(collector)) : (collector ?? ''),
      );
      expect(key?.idSegment, token.physicalId).toBe(collector);
      expect(key?.position, token.physicalId).toBe(token.position);
    }
  });
});

describe('tokenCollectorKey', () => {
  it('keeps a plain integer as its own position and its zero-padded segment', () => {
    expect(tokenCollectorKey('7')).toEqual({ position: 7, idSegment: '0007' });
    expect(tokenCollectorKey('12')).toEqual({ position: 12, idSegment: '0012' });
    expect(tokenCollectorKey('1234')).toEqual({ position: 1234, idSegment: '1234' });
  });

  it('takes the first number inside a lettered collector number and folds the rest into the segment', () => {
    expect(tokenCollectorKey('1a')).toEqual({ position: 1, idSegment: '1a' });
    expect(tokenCollectorKey('T3')).toEqual({ position: 3, idSegment: 't3' });
    expect(tokenCollectorKey('12b')).toEqual({ position: 12, idSegment: '12b' });
    expect(tokenCollectorKey('S1\u2605')).toEqual({ position: 1, idSegment: 's1' });
    expect(tokenCollectorKey('0')).toBeUndefined();
  });

  it('yields nothing for a collector number with no positive number in it', () => {
    expect(tokenCollectorKey('')).toBeUndefined();
    expect(tokenCollectorKey('\u2605')).toBeUndefined();
    expect(tokenCollectorKey('abc')).toBeUndefined();
    expect(tokenCollectorKey('00')).toBeUndefined();
  });

  it('gives every collector number of a sheet a distinct segment, whichever way it is written', () => {
    const segments = ['1', '1a', '1b', 'T1', '01'].map((number) => tokenCollectorKey(number)?.idSegment);
    expect(new Set(segments).size).toBe(segments.length);
  });
});

describe('parseForgeTokenScript', () => {
  it('reads name, types, colors and P/T, with `all` and `colorless` as Forge means them', () => {
    expect(
      parseForgeTokenScript(
        'w_1_1_pegasus_flying.txt',
        'Name:Pegasus Token\nColors:white\nTypes:Creature Pegasus\nPT:1/1\n',
      ),
    ).toEqual({
      file: 'w_1_1_pegasus_flying.txt',
      name: 'Pegasus Token',
      types: ['Creature', 'Pegasus'],
      colors: ['W'],
      power: '1',
      toughness: '1',
    });
    expect(parseForgeTokenScript('all.txt', 'Name:Glass Token\nColors:all\nTypes:Artifact\n')).toMatchObject({
      colors: ['W', 'U', 'B', 'R', 'G'],
      power: null,
      toughness: null,
    });
    expect(
      parseForgeTokenScript(
        'c.txt',
        'Name:Thopter Token\nColors:colorless\nTypes:Artifact Creature Thopter\nPT:1/1\n',
      ),
    ).toMatchObject({ colors: [] });
    expect(parseForgeTokenScript('x.txt', 'Colors:red\n')).toBeUndefined();
    expect(() => parseForgeTokenScript('x.txt', 'Name:X\nColors:purple\nTypes:Creature\n')).toThrow(
      /unknown color/u,
    );
  });
});

describe('bindTokenPrintings', () => {
  const pegasusScript: ForgeTokenScript = {
    file: 'w_1_1_pegasus_flying.txt',
    name: 'Pegasus Token',
    types: ['Creature', 'Pegasus'],
    colors: ['W'],
    power: '1',
    toughness: '1',
  };
  const row = (fields: Partial<ScryfallCard>): ScryfallCard =>
    ({
      id: '72f80c50-e1c4-4e93-bd61-94cede85931d',
      oracle_id: '41014a6a-0f5b-48ae-8cb8-9a89f0f0180f',
      name: 'Pegasus',
      layout: 'token',
      collector_number: '7',
      type_line: 'Token Creature — Pegasus',
      colors: ['W'],
      power: '1',
      toughness: '1',
      oracle_text: 'Flying',
      image_uris: { art_crop: 'https://cards.example/pegasus.jpg' },
      ...fields,
    }) as ScryfallCard;

  it('keeps a token a Forge script witnesses and leaves out one nobody says', () => {
    const outcome = bindTokenPrintings(
      'TSCD',
      [row({}), row({ name: 'Emblem', layout: 'emblem' }), row({ name: 'Nobody', collector_number: '8' })],
      [pegasusScript],
    );
    expect(outcome.tokens.map((token) => [token.physicalId, token.observedNames])).toEqual([
      ['tscd-token:0007:72f80c50-e1c4-4e93-bd61-94cede85931d', ['Pegasus Token']],
    ]);
    expect(outcome.omitted.map((entry) => [entry.name, entry.reason])).toEqual([
      ['Emblem', 'layout emblem'],
      ['Nobody', 'no Forge token script'],
    ]);
  });

  it('binds a lettered or prefixed collector number under a derived id and keeps the sheet order', () => {
    const second = '11111111-2222-4333-8444-555555555555';
    const third = '22222222-3333-4444-8555-666666666666';
    const outcome = bindTokenPrintings(
      'TROE',
      [
        row({ id: second, collector_number: '1b' }),
        row({ id: third, collector_number: '2' }),
        row({ collector_number: '1a' }),
        row({ id: '33333333-4444-4555-8666-777777777777', collector_number: '\u2605' }),
      ],
      [pegasusScript],
    );
    expect(outcome.tokens.map((token) => [token.physicalId, token.position])).toEqual([
      ['troe-token:1a:72f80c50-e1c4-4e93-bd61-94cede85931d', 1],
      ['troe-token:1b:11111111-2222-4333-8444-555555555555', 1],
      ['troe-token:0002:22222222-3333-4444-8555-666666666666', 2],
    ]);
    expect(outcome.omitted.map((entry) => [entry.collectorNumber, entry.reason])).toEqual([
      ['\u2605', 'no position in the collector number'],
    ]);
  });

  it('refuses a script whose facts differ even when the name matches', () => {
    const outcome = bindTokenPrintings('TSCD', [row({ power: '2' })], [pegasusScript]);
    expect(outcome.tokens).toEqual([]);
    expect(outcome.omitted[0]?.reason).toBe('no Forge token script');
  });

  // The installed scripts, not hand-built ones: a hand-built script typed the way the alias
  // table was typed hid an alias that never matched Forge (mtg-bn1ah.1, mtg-9ggmy).
  const installed = [...forgeScripts().values()].flat();
  const wurm: Partial<ScryfallCard> = {
    name: 'Wurm',
    type_line: 'Token Artifact Creature — Wurm',
    colors: [],
    power: '3',
    toughness: '3',
  };

  it('binds a stated alias whose Forge name and type disagree with the printing (mtg-bn1ah.1)', () => {
    const outcome = bindTokenPrintings(
      'TSOM',
      [row({ ...wurm, collector_number: '8' }), row({ ...wurm, collector_number: '9' })],
      installed,
    );
    expect(outcome.tokens.map((token) => token.observedNames)).toEqual([
      ['Phyrexian Wurm Token'],
      ['Phyrexian Wurm Token'],
    ]);
    expect(outcome.omitted).toEqual([]);
  });

  it('adds a stated alias to the scripts a printing already matches by name (mtg-9ggmy)', () => {
    const germ: Partial<ScryfallCard> = {
      name: 'Germ',
      type_line: 'Token Creature — Germ',
      colors: ['B'],
      power: '0',
      toughness: '0',
    };
    const outcome = bindTokenPrintings(
      'TMBS',
      [row({ ...germ, collector_number: '1' }), row({ ...germ, collector_number: '2' })],
      installed,
    );
    expect(outcome.tokens.map((token) => token.observedNames)).toEqual([
      ['Germ Token', 'Phyrexian Germ Token'],
      ['Germ Token'],
    ]);
  });

  it('does not use a stated alias for a collector number it does not name', () => {
    const outcome = bindTokenPrintings('TSOM', [row({ ...wurm, collector_number: '99' })], installed);
    expect(outcome.tokens).toEqual([]);
    expect(outcome.omitted[0]?.reason).toBe('no Forge token script');
  });

  it('states each Wurmcoil Wurm for its own script, so the chooser picks its own art', () => {
    const byFile = (file: string) => installed.find((script) => script.file === file)!;
    expect(
      statedAliasesFor(byFile('c_3_3_a_phyrexian_wurm_deathtouch.txt')).map((a) => a.collectorNumber),
    ).toEqual(['8']);
    expect(
      statedAliasesFor(byFile('c_3_3_a_phyrexian_wurm_lifelink.txt')).map((a) => a.collectorNumber),
    ).toEqual(['9']);
    expect(statedAliasesFor(byFile('b_0_0_phyrexian_germ.txt'))).toMatchObject([
      { setCode: 'TMBS', collectorNumber: '1' },
    ]);
    expect(statedAliasesFor(byFile('b_0_0_germ.txt'))).toEqual([]);
  });
});
