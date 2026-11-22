import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadForgeDeckFile } from '../../tools/forge-deck-file';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-forge-deck-file-test-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function save(bytes: string | Uint8Array): string {
  const path = join(root, 'deck.dck');
  writeFileSync(path, bytes);
  return path;
}

describe('Forge deck file loader', () => {
  it('hashes exact bytes and aggregates duplicate main-deck names', () => {
    const body =
      '[metadata]\r\nName=Pinned deck\r\n[main]\r\n1 Lightning Bolt|M11\r\n2 Island\r\n3 Lightning Bolt|2XM\r\n';

    expect(loadForgeDeckFile(save(body))).toEqual({
      path: join(root, 'deck.dck'),
      sha256: createHash('sha256').update(body).digest('hex'),
      deck: {
        name: 'Pinned deck',
        cards: [
          { name: 'Lightning Bolt', count: 4 },
          { name: 'Island', count: 2 },
        ],
      },
    });
  });

  it.each([
    ['', /metadata/i],
    ['[metadata]\nName=x\n[main]\n', /card/i],
    ['[metadata]\nName=x\n[main]\n0 Island\n', /count/i],
    ['[metadata]\nName=x\n[main]\n1  Island\n', /card entry/i],
    ['[metadata]\nName=x\n[main]\n1 Island|m11\n', /set code/i],
    ['[metadata]\nName=x\n[main]\n1 Island\n[sideboard]\n1 Bolt\n', /section/i],
    ['[metadata]\nName=x\nName=y\n[main]\n1 Island\n', /name/i],
  ])('rejects non-canonical content %#', (body, message) => {
    expect(() => loadForgeDeckFile(save(body))).toThrow(message);
  });

  it('rejects malformed UTF-8 instead of replacing bytes during parsing', () => {
    expect(() =>
      loadForgeDeckFile(
        save(Uint8Array.from([0x5b, 0x6d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61, 0x5d, 0x0a, 0xff])),
      ),
    ).toThrow(/UTF-8/i);
  });
});
