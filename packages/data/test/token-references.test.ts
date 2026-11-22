/**
 * A cube's token sheet is derived from what its card scripts create, so the
 * derivation is pinned, and the installed Legacy Cube sheet is checked against
 * the installed scripts: every token script the cube's 600 cards name is
 * witnessed by a printing, except the ones this test names as left out.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrintedTokenPrintings } from '@mtg/printed-card';
import { readForgeScriptArchive } from '../src/printed-card/forge-install';
import { catalogTokenScriptReferences } from '../src/printed-card/token-references';
import { parseForgeTokenScript } from '../src/printed-card/token-printings';

const dataRoot = new URL('../data/', import.meta.url);
const scriptsDirectory = new URL('../../../tools/forge/dist/res/tokenscripts/', import.meta.url);

/**
 * Wurmcoil Engine's two 3/3s. Forge names them "Phyrexian Wurm Token";
 * Scryfall prints them as "Wurm" with Phyrexian Wurm for a type line, and a
 * name nobody witnessed matches nothing, so the board draws their pending
 * frame. Remove a row here the day a printing is bound.
 *
 * Batterskull's and Kaldra Compleat's Living Weapon Germ: the sheet predates
 * the reader seeing keyword-created tokens, so no printing is bound (`mtg-9ggmy`).
 */
const LEFT_OUT = [
  'b_0_0_phyrexian_germ',
  'c_3_3_a_phyrexian_wurm_deathtouch',
  'c_3_3_a_phyrexian_wurm_lifelink',
];

describe('catalogTokenScriptReferences', () => {
  it('reads every TokenScript$ reference once, including comma lists', () => {
    const body = [
      'Name:Example',
      'T:Mode$ ChangesZone | Execute$ TrigToken',
      'SVar:TrigToken:DB$ Token | TokenScript$ g_3_3_elephant,w_1_1_soldier | TokenOwner$ You',
      'SVar:Again:DB$ Token | TokenScript$ g_3_3_elephant',
      'SVar:Copy:DB$ CopyPermanent | Defined$ Self',
    ].join('\n');
    const archive = new Map([
      ['a/example.txt', Buffer.from(body)],
      ['n/no_tokens.txt', Buffer.from('Name:No Tokens\nOracle:Flying')],
    ]);
    expect(catalogTokenScriptReferences(['a/example.txt'], archive)).toEqual([
      'g_3_3_elephant',
      'w_1_1_soldier',
    ]);
    expect(catalogTokenScriptReferences(['n/no_tokens.txt'], archive)).toEqual([]);
  });

  it('reads the Germ a Living Weapon keyword creates, which no TokenScript$ line names', () => {
    const archive = new Map([
      ['f/flayer_husk.txt', Buffer.from('Name:Flayer Husk\nK:Living Weapon\nK:Equip:2\n')],
      [
        'm/mortarpod.txt',
        Buffer.from(
          'Name:Mortarpod\nK:Living Weapon\nSVar:X:DB$ Token | TokenScript$ b_0_0_phyrexian_germ\n',
        ),
      ],
    ]);
    expect(catalogTokenScriptReferences(['f/flayer_husk.txt'], archive)).toEqual(['b_0_0_phyrexian_germ']);
    expect(catalogTokenScriptReferences(['f/flayer_husk.txt', 'm/mortarpod.txt'], archive)).toEqual([
      'b_0_0_phyrexian_germ',
    ]);
  });

  it('refuses a catalog script the archive does not hold', () => {
    const archive = new Map([['a/a.txt', Buffer.from('SVar:X:DB$ Token | TokenScript$ b_1_1')]]);
    expect(catalogTokenScriptReferences(['a/a.txt'], archive)).toEqual(['b_1_1']);
    expect(() => catalogTokenScriptReferences(['a/a.txt', 'z/missing.txt'], archive)).toThrow(
      'Forge script archive does not hold z/missing.txt',
    );
  });
});

describe('the installed Legacy Cube token sheet', () => {
  it('witnesses every token script the cube cards create, except the ones named as left out', () => {
    const catalog = JSON.parse(
      readFileSync(new URL('legacy-cube-2021-card-catalog-v1.json', dataRoot), 'utf8'),
    ) as { readonly cards: readonly { readonly forgeScript: string }[] };
    const references = catalogTokenScriptReferences(
      catalog.cards.map((card) => card.forgeScript),
      readForgeScriptArchive(),
    );
    expect(references.length).toBeGreaterThan(50);
    const sheet = parsePrintedTokenPrintings(
      JSON.parse(readFileSync(new URL('legacy-cube-2021-token-printings-v1.json', dataRoot), 'utf8')),
    );
    const witnessed = new Set(sheet.tokens.flatMap((token) => token.observedNames));
    const unwitnessed = references.filter((reference) => {
      const script = parseForgeTokenScript(
        `${reference}.txt`,
        readFileSync(new URL(`${reference}.txt`, scriptsDirectory), 'utf8'),
      );
      if (script === undefined) throw new Error(`${reference} is not a token script`);
      return !witnessed.has(script.name);
    });
    expect(unwitnessed).toEqual(LEFT_OUT);
  });
});
