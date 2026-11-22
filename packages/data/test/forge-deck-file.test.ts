import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseForgeDeckFile } from '../src/printed-card/forge-deck-file';

const PRECONS = 'tools/forge/dist/res/quest/commanderprecons';

describe('Forge deck file reader', () => {
  it('reads sections, counts, set codes and a foil mark the way Forge writes them', () => {
    const deck = parseForgeDeckFile(
      [
        '[metadata]',
        'Name=Chaos Incarnate [SCD] [2022]',
        'Set=SCD',
        '[Commander]',
        '1 Kardur, Doomscourge|SCD|1',
        '[Main]',
        '1 Kalamax, the Stormsire+|C20',
        '10 Mountain|SCD|3',
        '1 Dusk // Dawn',
        '[Sideboard]',
        '',
      ].join('\r\n'),
    );
    expect(deck.name).toBe('Chaos Incarnate [SCD] [2022]');
    expect(deck.metadata).toEqual({ name: 'Chaos Incarnate [SCD] [2022]', set: 'SCD' });
    expect(deck.commanders).toEqual([{ name: 'Kardur, Doomscourge', setCode: 'SCD', count: 1 }]);
    expect(deck.main).toEqual([
      { name: 'Kalamax, the Stormsire', setCode: 'C20', count: 1 },
      { name: 'Mountain', setCode: 'SCD', count: 10 },
      { name: 'Dusk // Dawn', count: 1 },
    ]);
    expect(deck.sideboard).toEqual([]);
  });

  it('accepts lower-case headers and two headers on one line', () => {
    const deck = parseForgeDeckFile(
      '[metadata]\nname=Old\n[commander]\n1 A\n[main]\n2 B\n[Sideboard][metadata]\nSet=C13\n',
    );
    expect(deck.commanders).toEqual([{ name: 'A', count: 1 }]);
    expect(deck.main).toEqual([{ name: 'B', count: 2 }]);
    expect(deck.metadata['set']).toBe('C13');
  });

  it.each([
    ['an unknown section', '[metadata]\nName=x\n[Avatar]\n1 A\n', /unknown section \[Avatar\]/],
    ['a card before any section', '1 A\n[metadata]\nName=x\n', /before any section/],
    ['a line with no count', '[metadata]\nName=x\n[Main]\nLightning Bolt\n', /expected "<count> <name>"/],
    ['a zero count', '[metadata]\nName=x\n[Main]\n0 Lightning Bolt\n', /at least one/],
    ['a deck with no name', '[metadata]\nSet=SCD\n[Main]\n1 A\n', /names no deck/],
  ])('refuses %s', (_label, body, message) => {
    expect(() => parseForgeDeckFile(body)).toThrow(message);
  });

  it('reads every Commander precon Forge ships, each with exactly one command zone card', () => {
    const files = readdirSync(PRECONS).filter((file) => file.endsWith('.dck'));
    expect(files.length).toBe(173);
    for (const file of files) {
      const deck = parseForgeDeckFile(readFileSync(join(PRECONS, file), 'utf8'));
      expect(deck.commanders.length, file).toBeGreaterThanOrEqual(1);
      expect(deck.main.length, file).toBeGreaterThan(0);
    }
  });
});
