/**
 * Two named parts, exported.
 *
 * the set design document gives every dropped part the same shape:
 * decision 8 names roughly eight parts, decision 9 gives each one Fuse and
 * nothing else, and the mechanics section spells the token out as "an artifact
 * whose only ability is Fuse". Nothing in it distinguishes one part from
 * another except the name and the counter, and a part has no body to write two
 * numbers from. The document states no subtype; a set that gives its parts a
 * shared one, as these fixtures do with `Part`, has nothing else to tell them
 * apart by.
 *
 * That collided. `forgeTokenScriptName` took a bodiless token's identity from
 * its subtypes, so Trophy Horn and Bone Shard both rendered `c_a_part` and
 * `transpileSet` refused the set with `DUPLICATE_TOKEN_SCRIPT`, advising the
 * caller to give the tokens distinct subtypes or stats — which a part cannot
 * do. The set the flagship exists to ship could not be exported at all. A
 * bodiless token now carries its own name, and the two cards below are the set
 * the finding was reproduced on.
 */
import { describe, expect, it } from 'vitest';
import type { Card, TokenSpecInput } from '@mtg/dsl';
import { parseCard, TokenSpecSchema } from '@mtg/dsl';
import { forgeTokenScriptName, transpileSet } from '@mtg/forge-export';

const EDITION = { name: 'the flagship set', date: '2026-08-12' };

/**
 * `Fuse {1}: Sacrifice this. Put a horn counter on target creature you control.`
 *
 * The real part counter, not a stand-in `+1/+1`: a set of two named parts that
 * places no part counter would leave the export's whole parts path untested.
 * `horn` is the one part kind `COUNTER_DECLARATIONS` declares so far, so
 * both fixtures place it; what is under test here is the file name, and the
 * counter is what makes these parts rather than +1/+1 tokens.
 */
function part(name: string): TokenSpecInput {
  return {
    name,
    subtypes: ['Part'],
    colors: [],
    keywords: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, sacrificeSelf: true },
        effects: [
          {
            kind: 'putCounters',
            counter: 'horn',
            count: 1,
            target: { kind: 'targetCreatureYouControl' },
          },
        ],
      },
    ],
  };
}

function monster(id: string, collectorNumber: number, name: string, drop: TokenSpecInput): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber },
    manaCost: { generic: 3, R: 1 },
    colors: ['R'],
    subtypes: ['Monster'],
    power: 4,
    toughness: 4,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'createToken', count: 1, token: drop }],
      },
    ],
  });
}

const SILVER_DIREHORN = monster('xmp-1', 1, 'Silver Direhorn', part('Trophy Horn'));
const BRIGAND = monster('xmp-2', 2, 'Brigand', part('Bone Shard'));

describe('a set that drops two named parts', () => {
  it('gives each part a script name of its own', () => {
    const horn = forgeTokenScriptName(TokenSpecSchema.parse(part('Trophy Horn')));
    const shard = forgeTokenScriptName(TokenSpecSchema.parse(part('Bone Shard')));
    expect(horn).toBe('c_a_trophy_horn_part');
    expect(shard).toBe('c_a_bone_shard_part');
  });

  it('exports rather than collapsing both parts onto one script', () => {
    const result = transpileSet([SILVER_DIREHORN, BRIGAND], EDITION);
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;

    expect(result.value.tokens.map((file) => file.path)).toEqual([
      'tokens/c_a_trophy_horn_part.txt',
      'tokens/c_a_bone_shard_part.txt',
    ]);

    // Every TokenScript the two cards reference is a file the export wrote.
    const referenced = result.value.cards.flatMap((file) =>
      [...file.contents.matchAll(/TokenScript\$ (\S+)/g)].map(([, name = '']) => name),
    );
    expect(referenced).toEqual(['c_a_trophy_horn_part', 'c_a_bone_shard_part']);
    const written = new Set(result.value.tokens.map((file) => file.path));
    expect(referenced.filter((name) => !written.has(`tokens/${name}.txt`))).toEqual([]);
  });

  /**
   * The name is folded in beside the subtype rather than swapped for it, so an
   * exported part still reads as a part, and the token file Forge loads still
   * declares the type the design gave it.
   */
  it('keeps the subtype beside the name', () => {
    const result = transpileSet([SILVER_DIREHORN], EDITION);
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;
    const file = result.value.tokens[0];
    expect(file?.path).toBe('tokens/c_a_trophy_horn_part.txt');
    expect(file?.contents).toContain('Types:Artifact Part');
    expect(file?.contents).toContain('Name:Trophy Horn Token');
  });

  /**
   * Fuse's controller restriction crosses the boundary rather than being
   * dropped at it.
   *
   * Forge writes a restriction as a dotted qualifier on the target type, so
   * `targetCreatureYouControl` is `Creature.YouCtrl` and nothing else about the
   * ability moves. The plain `Creature` is asserted absent as well, because the
   * two spellings differ by a suffix and an export that silently widened the
   * target would still contain the narrower string.
   */
  it("exports the part's controller restriction as a Forge target qualifier", () => {
    const result = transpileSet([SILVER_DIREHORN], EDITION);
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;
    const contents = result.value.tokens[0]?.contents ?? '';
    expect(contents).toContain('ValidTgts$ Creature.YouCtrl');
    expect(contents).not.toContain('ValidTgts$ Creature |');
  });

  /**
   * A subtype the name already spells is not written twice: Forge's own
   * `c_a_treasure` grammar survives a token that is named after its type.
   */
  it('does not double a subtype the name already spells', () => {
    const treasure = TokenSpecSchema.parse({
      name: 'Treasure',
      subtypes: ['Treasure'],
      colors: [],
      keywords: [],
    });
    expect(forgeTokenScriptName(treasure)).toBe('c_a_treasure');
  });
});

/**
 * Five differently-named 0/1 colorless tokens sharing the subtype `Part`,
 * reproducing the flagship's `DUPLICATE_TOKEN_SCRIPT x11` finding: a
 * creature token (one with stats, unlike the bodiless parts above) took its
 * script identity from subtypes alone and dropped its name entirely once a
 * subtype was present, so all five asked for `c_0_1_part`.
 */
describe('a set that mints several same-subtype creature tokens', () => {
  function statPart(name: string): TokenSpecInput {
    return {
      name,
      subtypes: ['Part'],
      colors: [],
      power: 0,
      toughness: 1,
      keywords: [],
    };
  }

  const names = ['Part', 'Goblin Horn', 'Ember Bat Wing', 'Marsh Newt Talon', 'Wyrm Flame Horn'];

  it('gives each token a distinct script name', () => {
    const scriptNames = names.map((name) => forgeTokenScriptName(TokenSpecSchema.parse(statPart(name))));
    expect(new Set(scriptNames).size).toBe(names.length);
    expect(scriptNames).toEqual([
      'c_0_1_part',
      'c_0_1_goblin_horn_part',
      'c_0_1_ember_bat_wing_part',
      'c_0_1_marsh_newt_talon_part',
      'c_0_1_wyrm_flame_horn_part',
    ]);
  });

  it('exports all five drops without a DUPLICATE_TOKEN_SCRIPT rejection', () => {
    const monsters = names.map((name, index) =>
      monster(`xmp-part-${index}`, 100 + index, `${name} Monster`, statPart(name)),
    );
    const result = transpileSet(monsters, EDITION);
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;
    expect(result.value.tokens.length).toBe(names.length);
  });
});
