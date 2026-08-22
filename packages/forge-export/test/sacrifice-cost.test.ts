/**
 * The sacrifice half of a Forge `Cost$`, read off the file on disk.
 *
 * This package's failures are silent by construction: `transpileSet` returns an
 * `ok` result and the suite goes green while the exported file says something
 * Forge would refuse, or would accept and play wrongly. Slice B shipped a
 * dangling token reference that way and slice C shipped an activated line
 * nothing read back. So the assertion here is the whole `A:` line, taken from
 * the written file rather than from the transpiler's return value.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { transpileSet, writeForgeSet } from '@mtg/forge-export';

const EDITION = { name: 'the flagship set', date: '2026-08-12' };

/** `{1}{R}, {T}, Sacrifice CARDNAME: CARDNAME deals 2 damage to any target.` */
function bombBag() {
  return parseCard({
    kind: 'artifact',
    id: 'xmp-bomb-bag',
    name: 'Bomb Bag',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 11 },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1, R: 1 }, tapSelf: true, sacrificeSelf: true },
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      },
    ],
  });
}

/** `Sacrifice CARDNAME: You gain 2 life.` A cost with no mana and no tap. */
function keepsakeChime() {
  return parseCard({
    kind: 'artifact',
    id: 'xmp-keepsake-chime',
    name: 'Keepsake Chime',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 12 },
    manaCost: { generic: 1 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, sacrificeSelf: true },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

describe('a sacrifice in the Forge cost string', () => {
  /**
   * `Cost$ 1 R T Sac<1/CARDNAME>`: generic, then one letter per colored pip,
   * then the tap symbol, then the sacrifice, which is the order and the
   * spelling `res/cardsfolder` uses. Unverified against a booted Forge, exactly
   * as the rest of this mapping is; `mtg-17a` is the check and it is blocked on
   * the Forge harness.
   */
  it('writes the whole activated line, sacrifice included, into the card file', () => {
    const card = bombBag();
    const result = transpileSet([card], EDITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-sacrifice-'));
    writeForgeSet(customDir, result.value);
    const text = readFileSync(join(customDir, 'cards', 'bomb_bag.txt'), 'utf8');
    const lines = text.split('\n');

    expect(lines).toContain(
      'A:AB$ DealDamage | Cost$ 1 R T Sac<1/CARDNAME> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ {1}{R}, {T}, Sacrifice CARDNAME: CARDNAME deals 2 damage to any target.',
    );
    expect(text).toContain(`Oracle:${renderOracleText(card)}`);
    expect(lines.filter((line) => line.startsWith('SVar:'))).toEqual([]);
  });

  /**
   * A cost that is only a sacrifice is a real Forge cost string, so it must not
   * take the empty-cost rejection: `activatedScript` refuses an activation with
   * nothing to pay, and reading that check as "no mana and no tap" would reject
   * a card `checkAbilities` accepts. The DSL and the transpiler have to agree
   * about which cards exist.
   */
  it('writes a sacrifice-only cost rather than rejecting the card', () => {
    const card = keepsakeChime();
    const result = transpileSet([card], EDITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-sacrifice-only-'));
    writeForgeSet(customDir, result.value);
    const lines = readFileSync(join(customDir, 'cards', 'keepsake_chime.txt'), 'utf8').split('\n');

    expect(lines).toContain(
      'A:AB$ GainLife | Cost$ Sac<1/CARDNAME> | Defined$ You | LifeAmount$ 2 | SpellDescription$ Sacrifice CARDNAME: You gain 2 life.',
    );
    // Never `Cost$ 0 Sac<…>`: a Forge cost of nothing is written `0`, and a
    // cost that has something in it must not carry the zero as well.
    expect(lines.some((line) => line.includes('Cost$ 0'))).toBe(false);
  });
});
