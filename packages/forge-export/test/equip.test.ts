/**
 * A named weapon crosses into Forge as the card Forge already knows how to
 * play, read off the file on disk.
 *
 * CR 702.6b's equip clause is one field on an activated ability in the DSL
 * (`AttachSchema`) and two printed lines on the card, "Equipped creature gets
 * +2/+0." and "Equip {2}". Forge writes the same card as `K:Equip:2` plus a
 * static over `Creature.EquippedBy`, which is `Bonesplitter` in 2.0.14's
 * `res/cardsfolder`:
 *
 *     Name:Bonesplitter
 *     ManaCost:1
 *     Types:Artifact Equipment
 *     K:Equip:1
 *     S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | Description$ Equipped creature gets +2/+0.
 *     Oracle:Equipped creature gets +2/+0.\nEquip {1}
 *
 * Before this file the transpiler had no equip form at all, so it took the
 * ability through the activated path, hit the two-line description, and refused
 * every weapon in the set as `UNSAFE_SCRIPT_TEXT` — the refusal
 * the set design document records beside the attachment row.
 *
 * Two things here are read off shipped card scripts and not off a game Forge
 * ran, the standing gap this whole package carries (`mtg-17a`). The first is
 * the pair of lines above. The second is narrower and is stated where it is
 * asserted: `AddToughness$ +0`, which this transpiler writes for the zero half
 * of a stat bonus, appears nowhere in the 33,587 shipped scripts. Its two
 * halves each do — a signed magnitude ships as `AddPower$ +2` (Tidal Influence,
 * Vivien Reid) and a zero magnitude ships as `SetPower$ 0` in 19 scripts — and
 * Forge's own idiom is to omit the zero component the way Bonesplitter does.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard, renderAbility, renderOracleText } from '@mtg/dsl';
import { transpileSet, writeForgeSet } from '@mtg/forge-export';

const EDITION = { name: 'the flagship set', date: '2026-08-12' };

/** `Equipped creature gets +2/+0.` / `Equip {2}` — the set's marquee weapon. */
const MOONBLADE: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-moonblade',
  name: 'Moonblade',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
  ],
});

/** A weapon that grants a keyword, on a colored equip cost. */
const SAVAGE_DIREHORN_BOW: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-savage-direhorn-bow',
  name: 'Savage Direhorn Bow',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 2 },
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, R: 1 } },
      attach: { modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
      effects: [],
    },
  ],
});

function scriptFor(card: Card, fileName: string): string {
  const result = transpileSet([card], EDITION);
  if (!result.ok) throw new Error(JSON.stringify(result.rejections));
  const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-equip-'));
  writeForgeSet(customDir, result.value);
  return readFileSync(join(customDir, 'cards', fileName), 'utf8');
}

describe('a weapon in Forge', () => {
  /**
   * The whole file, because this package's failures are silent by
   * construction: a partial assertion goes green over a script that boots and
   * plays a different card. Line for line it is Bonesplitter with a bigger
   * cost, save the signed deltas this transpiler already writes for every
   * static and the zero half of the bonus, which Bonesplitter omits.
   */
  it('writes the equip keyword and the static it carries', () => {
    expect(scriptFor(MOONBLADE, 'moonblade.txt')).toBe(
      [
        'Name:Moonblade',
        'ManaCost:2',
        'Types:Artifact Equipment',
        'K:Equip:2',
        'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ +2 | AddToughness$ +0 | Description$ Equipped creature gets +2/+0.',
        'Oracle:Equipped creature gets +2/+0.\\nEquip {2}',
        '',
      ].join('\n'),
    );
  });

  /**
   * `K:Equip:1 R` is the cost string Forge's own equipment use for a colored
   * equip cost: six scripts in 2.0.14 carry exactly that line. The grammar
   * after the colon is `Cost$`'s, which is why the transpiler builds both with
   * one function.
   */
  it('writes a colored equip cost and the keyword the weapon grants', () => {
    const lines = scriptFor(SAVAGE_DIREHORN_BOW, 'savage_direhorn_bow.txt').split('\n');
    expect(lines).toContain('K:Equip:1 R');
    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ First Strike | Description$ Equipped creature has first strike.',
    );
  });

  /**
   * The equip ability is a keyword line and nothing else. An `A:` line beside
   * it would be the same ability twice: Forge would offer the printed equip and
   * a second activation costing the same mana, so the card in the parity oracle
   * would not be the card the kernel plays.
   */
  it('writes no activated line for the ability the keyword already is', () => {
    const lines = scriptFor(MOONBLADE, 'moonblade.txt').split('\n');
    expect(lines.filter((line) => line.startsWith('A:'))).toEqual([]);
    expect(lines.filter((line) => line.startsWith('SVar:'))).toEqual([]);
    expect(lines.filter((line) => line.startsWith('K:'))).toEqual(['K:Equip:2']);
  });

  /**
   * The `Description$` is the DSL's own first printed line and the `Oracle:` is
   * both of them, so the script cannot say something the card does not. The
   * assertions above are strings; these are what makes them worth pinning.
   */
  it('takes both lines from the DSL renderer, and spends each once', () => {
    const printed = renderAbility(MOONBLADE.abilities[0]!, 'CARDNAME').split('\n');
    expect(printed).toEqual(['Equipped creature gets +2/+0.', 'Equip {2}']);

    const text = scriptFor(MOONBLADE, 'moonblade.txt');
    expect(text).toContain(`Description$ ${printed[0]!}`);
    expect(text).toContain(`Oracle:${renderOracleText(MOONBLADE).replace('\n', '\\n')}`);
  });

  /**
   * Two modifications, one `S:` line.
   *
   * Forge names `Affected$` once per static ability and reads one
   * `Description$` from it, so a second line would put the clause's whole
   * sentence in the text box twice and describe a card with two static
   * abilities where the DSL has one. `Bonesplitter` is `AddPower$ 2` alone;
   * `Basilisk Collar` is Forge's own example of the merged form, an
   * `AddKeyword$` beside its stat parameters on one line.
   */
  it('writes a stat bonus and a granted keyword on one static line', () => {
    const obliterator: Card = parseCard({
      kind: 'artifact',
      id: 'xmp-last-blow-obliterator',
      name: 'Last-Blow Obliterator',
      rarity: 'uncommon',
      set: { code: 'XMP', collectorNumber: 4 },
      supertypes: ['legendary'],
      manaCost: { generic: 3 },
      subtypes: ['Equipment'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'statBonus', power: 99, toughness: -3 },
              { kind: 'grantKeyword', keyword: 'deathtouch' },
            ],
          },
          effects: [],
        },
      ],
    });
    const lines = scriptFor(obliterator, 'lastblow_obliterator.txt').split('\n');
    expect(lines.filter((line) => line.startsWith('S:'))).toEqual([
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ +99 | AddToughness$ -3 | AddKeyword$ Deathtouch | Description$ Equipped creature gets +99/-3 and has deathtouch.',
    ]);
    expect(lines).toContain('K:Equip:1');
  });

  /**
   * A weapon may print an ordinary static beside its equip clause, and the two
   * are different scopes: one names the creature this is attached to, the other
   * names a board. A shared `Affected$` would make the lord pump whatever the
   * weapon happened to be on.
   */
  it('keeps the equipped creature and a printed static apart', () => {
    const direhornCrusher: Card = parseCard({
      kind: 'artifact',
      id: 'xmp-direhorn-crusher',
      name: 'Direhorn Crusher',
      rarity: 'rare',
      set: { code: 'XMP', collectorNumber: 3 },
      manaCost: { generic: 4 },
      subtypes: ['Equipment'],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          modification: { kind: 'statBonus', power: 1, toughness: 0 },
        },
        {
          kind: 'activated',
          cost: { mana: { generic: 3 } },
          attach: { modifications: [{ kind: 'statBonus', power: 3, toughness: 3 }] },
          effects: [],
        },
      ],
    });
    const statics = scriptFor(direhornCrusher, 'direhorn_crusher.txt')
      .split('\n')
      .filter((line) => line.startsWith('S:'));
    expect(statics).toHaveLength(2);
    expect(statics[0]).toContain('Affected$ Creature.YouCtrl');
    expect(statics[0]).toContain('AddPower$ +1');
    expect(statics[1]).toContain('Affected$ Creature.EquippedBy');
    expect(statics[1]).toContain('AddPower$ +3');
  });
});
