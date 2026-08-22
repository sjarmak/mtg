/**
 * Edition files, deck files, and the on-disk export layout.
 *
 * These formats are as load-bearing as the card scripts: Forge silently
 * ignores an edition it cannot parse, which would leave the boot gate playing
 * cards from the wrong printing.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASIC_LANDS, EXAMPLE_CARDS, EXAMPLE_SET, parseCard, renderOracleText } from '@mtg/dsl';
import {
  coverageDecks,
  deckSize,
  renderDeck,
  renderEdition,
  transpileSet,
  writeForgeSet,
} from '@mtg/forge-export';

const EDITION = { name: 'Slice Toy Set', date: '2026-08-09' };

describe('edition file', () => {
  it('writes Custom metadata and a collector-ordered card list', () => {
    const text = renderEdition('SLC', EXAMPLE_SET, EDITION);
    expect(text.startsWith('[metadata]\nCode=SLC\nName=Slice Toy Set\nDate=2026-08-09\nType=Custom\n')).toBe(
      true,
    );
    expect(text).toContain('\n[cards]\n1 C Skywatch Sentinel\n');
    expect(text).toContain('\n3 U Lifebound Cleric\n');
    expect(text).toContain('\n14 R Wild Summons\n');
  });

  it('gives basic lands the L rarity code regardless of their DSL rarity', () => {
    const text = renderEdition('SLC', BASIC_LANDS, EDITION);
    for (const land of BASIC_LANDS) {
      expect(text).toContain(`${land.set.collectorNumber} L ${land.name}\n`);
    }
  });

  it('emits a Booster line and custom creature types only when asked', () => {
    const plain = renderEdition('SLC', EXAMPLE_SET, EDITION);
    expect(plain).not.toContain('Booster=');
    expect(plain).not.toContain('[CreatureTypes]');

    const rich = renderEdition('SLC', EXAMPLE_SET, {
      ...EDITION,
      booster: '10 Common, 3 Uncommon, 1 Rare, 1 BasicLand',
      creatureTypes: [['Skywatcher', 'Skywatchers']],
    });
    expect(rich).toContain('Booster=10 Common, 3 Uncommon, 1 Rare, 1 BasicLand\n');
    expect(rich).toContain('[CreatureTypes]\nSkywatcher:Skywatchers\n');
  });
});

describe('deck files', () => {
  it('renders the .dck format Forge reads', () => {
    expect(
      renderDeck({
        name: 'probe',
        entries: [
          { count: 4, cardName: 'Lightning Lash', setCode: 'SLC' },
          { count: 17, cardName: 'Mountain' },
        ],
      }),
    ).toBe(['[metadata]', 'Name=probe', '[main]', '4 Lightning Lash|SLC', '17 Mountain', ''].join('\n'));
  });

  it('builds 60-card decks that between them play every nonland card', () => {
    const decks = coverageDecks(EXAMPLE_SET, 'probe');
    expect(decks.length).toBeGreaterThanOrEqual(2);
    for (const deck of decks) expect(deckSize(deck)).toBe(60);

    const played = new Set(decks.flatMap((deck) => deck.entries.map((entry) => entry.cardName)));
    for (const card of EXAMPLE_CARDS) expect(played.has(card.name)).toBe(true);
  });

  it('references Forge-shipped basics without a set code', () => {
    const decks = coverageDecks(EXAMPLE_SET, 'probe');
    const landEntries = decks
      .flatMap((deck) => deck.entries)
      .filter((entry) => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(entry.cardName));
    expect(landEntries.length).toBeGreaterThan(0);
    for (const entry of landEntries) expect(entry.setCode).toBeUndefined();
  });

  it('returns no decks for a set with nothing castable', () => {
    expect(coverageDecks(BASIC_LANDS, 'probe')).toEqual([]);
  });
});

describe('on-disk layout', () => {
  it('writes cards, editions and tokens where Forge looks for custom content', () => {
    const result = transpileSet(EXAMPLE_SET, EDITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-export-'));
    const written = writeForgeSet(customDir, result.value);
    expect(written).toContain(join(customDir, 'editions', 'SLC.txt'));
    expect(written).toContain(join(customDir, 'cards', 'lightning_lash.txt'));
    expect(written).toContain(join(customDir, 'tokens', 'g_2_2_bear.txt'));
    expect(readFileSync(join(customDir, 'cards', 'lightning_lash.txt'), 'utf8')).toContain(
      'A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 |',
    );
  });

  /**
   * Every `TokenScript$` a card names has a token file behind it.
   *
   * A trigger declares its token the same way a spell effect does, and
   * `transpileCardScript` has to carry both lists out of the card: the
   * ability block's tokens and the spell block's. Dropping the ability half
   * left the whole repository green, because nothing read the two together.
   * The card still wrote `TokenScript$ w_1_1_windborn` and the export simply
   * had no `tokens/w_1_1_windborn.txt`, which is a set that boots in Forge and
   * fails at the moment the trigger resolves. Forge is the parity oracle, so a
   * silent hole there is worse than a loud one.
   *
   * Vale Pilgrim is the named B row this pins (the set brief
   * §3.3), and the assertion is over every reference in the export rather than
   * over that one card, so a second token-making ability shape inherits it.
   */
  it('writes a token file for every TokenScript a card references', () => {
    const valePilgrim = parseCard({
      kind: 'creature',
      id: 'svl-vale-pilgrim',
      name: 'Vale Pilgrim',
      rarity: 'common',
      set: { code: 'SVL', collectorNumber: 1 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      power: 1,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Windborn',
                power: 1,
                toughness: 1,
                colors: ['W'],
                subtypes: ['Windborn'],
                keywords: [],
              },
            },
          ],
        },
      ],
    });
    const result = transpileSet([valePilgrim], { name: 'Sundered Vale', date: '2026-08-11' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const referenced = result.value.cards.flatMap((file) =>
      [...file.contents.matchAll(/TokenScript\$ (\S+)/g)].map(([, name = '']) => name),
    );
    expect(referenced, 'the trigger no longer exports a token reference').toEqual(['w_1_1_windborn']);
    expect(result.value.tokens.map((file) => file.path)).toEqual(['tokens/w_1_1_windborn.txt']);

    const written = new Set(result.value.tokens.map((file) => file.path));
    const dangling = referenced.filter((name) => !written.has(`tokens/${name}.txt`));
    expect(dangling, 'a card names a token script the export never writes').toEqual([]);
    expect(result.value.tokens[0]?.contents).toContain('Types:Creature Windborn');
  });

  /**
   * The whole activated line, read off the file on disk.
   *
   * This package's failures are silent by construction: the transpiler returns
   * an `ok` result and the suite goes green while the exported file says
   * something Forge would refuse or, worse, would accept and play wrongly. So
   * the assertion is the file's text, and it is the complete line rather than a
   * substring — a `Cost$` that lost its tap symbol, a `ValidTgts$` that lost
   * its target, and a description that disagrees with the oracle text are all
   * things a `toContain('A:AB$')` would wave through.
   *
   * The description is `renderAbility`'s own output, which is what stops the
   * Forge card and the printed card disagreeing about what the ability says.
   */
  it('writes the whole activated line into the card file', () => {
    const beacon = parseCard({
      kind: 'artifact',
      id: 'xmp-ashen-beacon',
      name: 'Ashen Beacon',
      rarity: 'uncommon',
      set: { code: 'XMP', collectorNumber: 7 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1, R: 1 }, tapSelf: true },
          effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    const result = transpileSet([beacon], { name: 'the flagship set', date: '2026-08-12' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-activated-'));
    writeForgeSet(customDir, result.value);
    const text = readFileSync(join(customDir, 'cards', 'ashen_beacon.txt'), 'utf8');
    const lines = text.split('\n');

    expect(lines).toContain(
      'A:AB$ DealDamage | Cost$ 1 R T | ValidTgts$ Any | NumDmg$ 1 | SpellDescription$ {1}{R}, {T}: CARDNAME deals 1 damage to any target.',
    );
    expect(text).toContain(`Oracle:${renderOracleText(beacon)}`);
    // No `SP$` line: an activated ability is not what the card does when it
    // resolves, and an artifact has no spell effects at all.
    expect(lines.some((line) => line.startsWith('A:SP$'))).toBe(false);
    // Nothing dangling: the only `SVar:` names are ones this card writes.
    expect(lines.filter((line) => line.startsWith('SVar:'))).toEqual([]);
    expect(text).not.toContain('SubAbility$');
  });

  /**
   * A token made by an activation, followed from the `A:` line to the file.
   *
   * Slice B shipped this defect in the other direction: a card naming a
   * `TokenScript$` the export never wrote. The activated path collects tokens
   * in its own loop, so dropping the push there produces the same dangling
   * reference and no existing assertion notices, because every token test in
   * this package reaches the collector through a trigger. The assertion is the
   * whole chain: the `A:` line names a script, the export writes exactly that
   * file, and the file describes the token the DSL asked for.
   */
  it('writes the token file an activated ability asks for', () => {
    const forge = parseCard({
      kind: 'creature',
      id: 'xmp-emberkin-forgehand',
      name: 'Emberkin Forgehand',
      rarity: 'rare',
      set: { code: 'XMP', collectorNumber: 8 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      power: 2,
      toughness: 3,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: true },
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Ember',
                power: 1,
                toughness: 1,
                colors: ['R'],
                subtypes: ['Elemental'],
                keywords: [],
              },
            },
          ],
        },
      ],
    });
    const result = transpileSet([forge], { name: 'the flagship set', date: '2026-08-12' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const referenced = result.value.cards.flatMap((file) =>
      [...file.contents.matchAll(/TokenScript\$ (\S+)/g)].map(([, name = '']) => name),
    );
    expect(referenced, 'the activation no longer exports a token reference').toEqual([
      'r_1_1_ember_elemental',
    ]);
    expect(result.value.tokens.map((file) => file.path)).toEqual(['tokens/r_1_1_ember_elemental.txt']);

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-activated-token-'));
    writeForgeSet(customDir, result.value);
    const card = readFileSync(join(customDir, 'cards', 'emberkin_forgehand.txt'), 'utf8');
    const token = readFileSync(join(customDir, 'tokens', 'r_1_1_ember_elemental.txt'), 'utf8');
    expect(card.split('\n').some((line) => line.startsWith('A:AB$ Token |'))).toBe(true);
    expect(card).toContain('TokenScript$ r_1_1_ember_elemental');
    expect(token).toContain('Types:Creature Elemental');
    expect(token).toContain('PT:1/1');
  });

  /**
   * The set's own loop, followed out of the DSL and onto disk.
   *
   * A Monster drops a part, and a part is an artifact token whose only ability
   * spends it (the set design document). Three things could go
   * wrong quietly and each has a line here: the token could be written as a
   * creature with `PT:0/0`, its `A:` line could be dropped so Forge loads a
   * blank artifact, and its `Oracle:` could disagree with what the DSL prints.
   * The whole file is asserted rather than a substring, because a token missing
   * its ability still loads in Forge and still plays the game wrongly.
   *
   * The counter is `+1/+1`, the shape of a drop that upgrades a creature
   * without being a named part. The test below drops the real Trophy Horn,
   * whose counter is a part counter and reaches Forge as two counters.
   */
  it('writes an artifact token carrying its own activated ability', () => {
    const reaper = parseCard({
      kind: 'creature',
      id: 'xmp-brigand-reaper',
      name: 'Brigand Reaper',
      rarity: 'rare',
      set: { code: 'XMP', collectorNumber: 9 },
      manaCost: { generic: 3, R: 1 },
      colors: ['R'],
      subtypes: ['Brigand', 'Monster'],
      power: 4,
      toughness: 4,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Bone Shard',
                subtypes: ['Part'],
                abilities: [
                  {
                    kind: 'activated',
                    cost: { mana: { generic: 1 }, sacrificeSelf: true },
                    effects: [
                      {
                        kind: 'putCounters',
                        counter: 'plusOnePlusOne',
                        count: 1,
                        target: { kind: 'targetCreature' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const result = transpileSet([reaper], { name: 'the flagship set', date: '2026-08-12' });
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;

    const referenced = result.value.cards.flatMap((file) =>
      [...file.contents.matchAll(/TokenScript\$ (\S+)/g)].map(([, name = '']) => name),
    );
    // The script name carries the part's own name, not just its subtype: the
    // design gives a part nothing per-part but a name and a counter, and these
    // fixtures share the subtype `Part`, so a set that drops two of them needs
    // the name to tell them apart (`named-parts.test.ts`).
    expect(referenced).toEqual(['c_a_bone_shard_part']);
    expect(result.value.tokens.map((file) => file.path)).toEqual(['tokens/c_a_bone_shard_part.txt']);

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-part-token-'));
    writeForgeSet(customDir, result.value);
    const token = readFileSync(join(customDir, 'tokens', 'c_a_bone_shard_part.txt'), 'utf8');
    const printed = '{1}, Sacrifice Bone Shard: Put a +1/+1 counter on target creature.';
    expect(token).toBe(
      [
        'Name:Bone Shard Token',
        'ManaCost:no cost',
        'Types:Artifact Part',
        'A:AB$ PutCounter | Cost$ 1 Sac<1/CARDNAME> | ValidTgts$ Creature | CounterType$ P1P1 | CounterNum$ 1 | SpellDescription$ {1}, Sacrifice CARDNAME: Put a +1/+1 counter on target creature.',
        `Oracle:${printed}`,
        '',
      ].join('\n'),
    );
    // No PT line at all, rather than a 0/0 Forge would load as a creature that
    // dies to the state-based actions the moment it arrives.
    expect(token.split('\n').some((line) => line.startsWith('PT:'))).toBe(false);
  });

  /**
   * The real Fuse, exported: a part counter reaches Forge as the counters its
   * declaration decomposes into.
   *
   * Forge's counter types are fixed names with fixed meanings and none of them
   * means "+1/+1 and first strike". It does not need one: `PutCounter` takes
   * `CounterTypes$ A,B` and puts one of each (Champion of Dusan writes
   * `CounterTypes$ P1P1,Trample`, Unexpected Fangs `CounterTypes$ P1P1,Lifelink`),
   * and Forge ships a first strike counter (Heightened Reflexes,
   * `CounterType$ First Strike`). All three are card scripts in 2.0.14's
   * `res/cardsfolder`.
   *
   * So Silver Direhorn exports, and this is the file it drops. The whole token
   * file is asserted rather than a substring: a `CounterTypes$` that lost its
   * keyword half still loads in Forge and plays the mechanic as a plain +1/+1,
   * which is the quiet divergence this package exists to refuse.
   */
  it('writes a part counter as the Forge counters it decomposes into', () => {
    const direhorn = parseCard({
      kind: 'creature',
      id: 'xmp-silver-direhorn',
      name: 'Silver Direhorn',
      rarity: 'rare',
      set: { code: 'XMP', collectorNumber: 10 },
      manaCost: { generic: 3, R: 1 },
      colors: ['R'],
      subtypes: ['Direhorn', 'Monster'],
      power: 4,
      toughness: 4,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Trophy Horn',
                subtypes: ['Part'],
                abilities: [
                  {
                    kind: 'activated',
                    cost: { mana: { generic: 1 }, sacrificeSelf: true },
                    effects: [
                      {
                        kind: 'putCounters',
                        counter: 'horn',
                        count: 1,
                        target: { kind: 'targetCreature' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const result = transpileSet([direhorn], { name: 'the flagship set', date: '2026-08-12' });
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;

    const customDir = mkdtempSync(join(tmpdir(), 'mtg-forge-part-counter-'));
    writeForgeSet(customDir, result.value);
    const token = readFileSync(join(customDir, 'tokens', 'c_a_trophy_horn_part.txt'), 'utf8');
    const fuse =
      'Put a horn counter on target creature. (A creature with a horn counter gets +1/+1 and has first strike.)';
    expect(token).toBe(
      [
        'Name:Trophy Horn Token',
        'ManaCost:no cost',
        'Types:Artifact Part',
        `A:AB$ PutCounter | Cost$ 1 Sac<1/CARDNAME> | ValidTgts$ Creature | CounterTypes$ P1P1,First Strike | CounterNum$ 1 | SpellDescription$ {1}, Sacrifice CARDNAME: ${fuse}`,
        `Oracle:{1}, Sacrifice Trophy Horn: ${fuse}`,
        '',
      ].join('\n'),
    );
  });

  it('writes no card script for the basics Forge already ships', () => {
    const result = transpileSet(EXAMPLE_SET, EDITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.cards.map((file) => file.path);
    expect(paths).not.toContain('cards/mountain.txt');
    expect(result.value.edition.contents).toContain('21 L Mountain\n');
  });
});
