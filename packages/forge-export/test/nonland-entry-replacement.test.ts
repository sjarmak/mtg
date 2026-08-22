/**
 * A nonland permanent that enters tapped has no Forge mapping here yet
 * (mtg-hgmz), so it is a named rejection rather than a script that quietly
 * prints an untapped rock.
 *
 * This is the co-design invariant `rejection.ts` opens with, applied to the
 * field `mtg-hgmz` widened: exporting Coldsteel Heart without its entry clause
 * would boot cleanly in Forge and hand the parity oracle a strictly better
 * card than the kernel runs, which is the exact divergence the transpiler
 * exists to catch. The land arm has said the same thing since
 * `UNMAPPED_NONBASIC_LAND` was written.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const ROCK = parseCard({
  kind: 'artifact',
  id: 'tst-coldsteel-heart',
  name: 'Coldsteel Heart',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 231 },
  manaCost: { generic: 2 },
  entryReplacement: { kind: 'entersTapped' },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
    },
  ],
});

const PLAIN_ROCK = parseCard({
  kind: 'artifact',
  id: 'tst-warm-heart',
  name: 'Warm Heart',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 232 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
    },
  ],
});

describe('a nonland entry replacement at the Forge boundary', () => {
  it('refuses a rock that enters tapped rather than dropping the clause', () => {
    const result = transpileCardScript(ROCK);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNMAPPED_ENTRY_REPLACEMENT', path: 'entryReplacement' }),
      ]),
    );
  });

  it('leaves the same rock without the clause alone', () => {
    const result = transpileCardScript(PLAIN_ROCK);
    expect(result.ok).toBe(true);
  });
});
