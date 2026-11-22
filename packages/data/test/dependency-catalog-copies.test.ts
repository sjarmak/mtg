/**
 * A block set's format ships its block-mates' catalogs beside its own, so a set staged as
 * a dependency exists once per directory that needs it: THS in `ths/`, `bng/` and `jou/`,
 * BNG in `bng/` and `jou/`, GTC and RTR in `gtc/` and `dgm/`, ISD in `isd/` and `dka/`.
 * That is a decision (`mtg-2246c`), and this file is what keeps it from being an accident.
 *
 * The copies cannot be merged into one file without re-admitting the formats that bind
 * them. A catalog's `contentSha256` covers its source provenance, and the format's
 * `sources[].catalogSha256`, the build evidence, the display metadata and the admission
 * subject each name a catalog by that hash. Two builds from two source pins therefore
 * hash differently over identical cards, and pointing BNG at `ths/`'s copy fails BNG's
 * build-evidence binding and its admission's catalog check. The registry's `catalogs[].file`
 * is also a bare filename read from the format's own directory, and the builder takes one
 * pin per build, so a format has no way to name a catalog built under another pin.
 *
 * What is left to guard is the part a reader would otherwise have to check by hand: that
 * the copies still describe the same printed cards. They differ in `source` and
 * `contentSha256` and nowhere else. A copy that gains a card-level difference is a real
 * finding (a newer Scryfall bulk corrected a card, or a script moved), and the lane that
 * introduces it explains it in that format's README rather than flattening it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dataRoot = new URL('../data/', import.meta.url);
const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, dataRoot), 'utf8')) as T;

interface Registry {
  readonly formats: readonly {
    readonly id: string;
    readonly catalogs: readonly { readonly code: string; readonly file: string }[];
  }[];
}
interface CatalogFile {
  readonly forgeVersion: string;
  readonly cards: readonly unknown[];
}

/** Every catalog the registry names, grouped by set code, each with the file it is staged as. */
function stagedCopies(): ReadonlyMap<string, readonly string[]> {
  const byCode = new Map<string, string[]>();
  for (const format of readJson<Registry>('printed-formats-v1.json').formats)
    for (const catalog of format.catalogs)
      byCode.set(catalog.code, [...(byCode.get(catalog.code) ?? []), `${format.id}/${catalog.file}`]);
  return byCode;
}

describe('a catalog staged in more than one format directory', () => {
  const duplicated = [...stagedCopies()].filter(([, files]) => files.length > 1);

  it('finds the block-mate copies the registry carries', () => {
    const theros = duplicated.find(([code]) => code === 'THS')?.[1];
    expect(theros).toEqual(
      expect.arrayContaining(['ths/ths-printed-catalog-v1.json', 'bng/ths-printed-catalog-v1.json']),
    );
  });

  it.each(duplicated)('%s copies describe the same printed cards', (code, files) => {
    const [first, ...rest] = files.map((file) => ({ file, catalog: readJson<CatalogFile>(file) }));
    for (const other of rest) {
      expect(other.catalog.cards, `${code} cards in ${other.file} against ${first!.file}`).toEqual(
        first!.catalog.cards,
      );
      expect(other.catalog.forgeVersion, `${code} Forge version in ${other.file}`).toBe(
        first!.catalog.forgeVersion,
      );
    }
  });
});
