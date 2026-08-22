/**
 * Rejection tests: every construct without a Forge mapping must fail loudly.
 *
 * A transpiler that quietly dropped an unmappable effect would still produce a
 * set that boots, so these tests are the ones that protect the invariant. They
 * deliberately push values the DSL's types forbid through `as`, because the
 * real threat model is unvalidated input (LLM output, JSON on disk), not
 * type-checked call sites.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect, TokenSpec } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCard, transpileEffect, transpileSet } from '@mtg/forge-export';
import { creature, spell } from './helpers';

const EDITION = { name: 'Rejection Probe', date: '2026-08-09' };

describe('unmapped vocabulary', () => {
  it('rejects an effect kind with no Forge API', () => {
    const rogue = { kind: 'exileCard', target: { kind: 'targetCreature' } } as unknown as Effect;
    const result = transpileEffect(rogue, 'tst-rogue', 'effects[0]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.message).toContain('exileCard');
  });

  it('rejects a keyword with no Forge K: mapping', () => {
    const card = { ...creature('Rogue Keyword'), keywords: ['shroud'] } as unknown as Card;
    const result = transpileCard(card);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_KEYWORD');
    expect(result.rejections[0]?.path).toBe('keywords[0]');
  });

  it('rejects a targeting mode the Forge mapping does not cover for that effect', () => {
    // `targetPlayer` used to be the rogue mode here; the sweeper made it a legal
    // one on this row, so the probe moved to a kind the row still refuses.
    // `anyTarget` is a creature-or-player choice, and "destroy any target" is
    // not a sentence the vocabulary offers.
    const rogue = {
      kind: 'destroyPermanent',
      target: { kind: 'anyTarget' },
    } as unknown as Effect;
    const result = transpileEffect(rogue, 'tst-rogue', 'effects[0]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_TARGET_FOR_EFFECT');
    expect(result.rejections[0]?.path).toBe('effects[0].target.kind');
  });

  it('rejects a targeting mode with no ValidTgts mapping at all', () => {
    const rogue = {
      kind: 'dealDamage',
      amount: 2,
      target: { kind: 'targetArtifact' },
    } as unknown as Effect;
    const result = transpileEffect(rogue, 'tst-rogue', 'effects[0]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_TARGET_FOR_EFFECT');
  });

  it('rejects a token keyword with no Forge mapping', () => {
    const rogue = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Bear', power: 2, toughness: 2, colors: [], subtypes: ['Bear'], keywords: ['shroud'] },
    } as unknown as Effect;
    const result = transpileEffect(rogue, 'tst-rogue', 'effects[0]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_KEYWORD');
    expect(result.rejections[0]?.path).toBe('effects[0].token.keywords[0]');
  });

  /**
   * Every counter kind the DSL declares now has Forge counters behind it
   * (`conformance.test.ts` checks each against its declaration), so the refusal
   * arm is reachable only the way this file's threat model says: a counter kind
   * that never went through `CounterKindSchema`. It stays because the next part
   * whose declaration Forge cannot decompose has to be refused rather than
   * exported as something narrower, and a `null` entry lands on this same line.
   */
  it('rejects a counter kind with no Forge counters', () => {
    const rogue = {
      kind: 'putCounters',
      counter: 'gloomSpike',
      count: 1,
      target: { kind: 'targetCreature' },
    } as unknown as Effect;
    const result = transpileEffect(rogue, 'tst-rogue', 'effects[0]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.path).toBe('effects[0].counter');
    expect(result.rejections[0]?.message).toContain('gloomSpike');
  });

  /**
   * A refusal two levels inside a card still reaches the caller, with the path
   * to the ability that caused it: a Monster's death trigger makes a part, and
   * the part carries an ability of its own. Nothing on that route may swallow a
   * rejection, because the alternative is an export that writes a token doing
   * nothing and boots cleanly.
   *
   * The unmappable thing is a free activation rather than a counter kind Forge
   * lacks, and that is not a free choice: `renderAbility` reads a counter's
   * declaration to print the ability, so a counter kind that never went through
   * `CounterKindSchema` throws inside `@mtg/dsl` before this transpiler sees
   * it. Every counter kind that has been declared now has Forge counters.
   */
  it('carries a refusal out of a token ability inside a trigger', () => {
    const direhorn = {
      ...creature('Silver Direhorn'),
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
                colors: [],
                keywords: [],
                abilities: [
                  {
                    kind: 'activated',
                    cost: {
                      mana: { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0 },
                      tapSelf: false,
                      sacrificeSelf: false,
                    },
                    effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as Card;
    const result = transpileCard(direhorn);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNSAFE_SCRIPT_TEXT');
    expect(result.rejections[0]?.path).toBe('abilities[0].effects[0].token.abilities[0].cost');
  });
});

describe('unsafe script text', () => {
  it('rejects a card name that would break the pipe-delimited grammar', () => {
    const card = { ...creature('Safe Name'), name: 'Bad | Name' } as Card;
    const result = transpileCard(card);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNSAFE_SCRIPT_TEXT');
  });

  it('rejects a card name that yields no script file name', () => {
    const card = { ...creature('Safe Name'), name: '???' } as Card;
    const result = transpileCard(card);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNSAFE_SCRIPT_TEXT');
  });

  it('rejects a token subtype containing a newline', () => {
    const rogue = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Bear', power: 2, toughness: 2, colors: [], subtypes: ['Be\nar'], keywords: [] },
    } as unknown as Effect;
    const result = transpileEffect(rogue, 'tst-rogue', 'effects[0]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNSAFE_SCRIPT_TEXT');
  });
});

describe('set-level rejections', () => {
  it('refuses to transpile a set containing a DSL-invalid card', () => {
    const illegal = { ...creature('Illegal Stats'), power: 99 } as Card;
    const result = transpileSet([illegal], EDITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('DSL_VIOLATION');
    expect(result.rejections[0]?.cardId).toBe(illegal.id);
  });

  it('rejects two cards that collapse onto one script file name', () => {
    const a = spell('Split Second', [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }], {
      id: 'tst-split-second-a',
    });
    const b = spell('Split: Second!', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], {
      id: 'tst-split-second-b',
    });
    const result = transpileSet([a, b], EDITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('DUPLICATE_SCRIPT_NAME');
  });

  it('rejects two distinctly-named tokens that collapse onto one token script', () => {
    // Two tokens the DSL, the kernel and the art manifest all keep apart:
    // `Glass` and `Glass Shard` are different names, so `validateTokenNames` has
    // nothing to say about them. Forge's namespace is coarser —
    // `tokenIdentityParts` folds away every subtype word the name already spells
    // — so both ask for `c_0_1_glass_shard`, with a different `Name:` line
    // inside. This is the flagship's own shape: its Part tokens all carry the
    // subtype `Part` and are told apart by name alone.
    const a = spell('Call the Cub', [
      {
        kind: 'createToken',
        count: 1,
        token: { name: 'Glass', power: 0, toughness: 1, subtypes: ['Shard'] },
      },
    ]);
    const b = spell('Call the Runt', [
      {
        kind: 'createToken',
        count: 1,
        token: { name: 'Glass Shard', power: 0, toughness: 1, subtypes: ['Shard'] },
      },
    ]);
    const result = transpileSet([a, b], EDITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_TOKEN_SCRIPT',
        cardId: b.id,
        path: 'effects',
        message: expect.stringContaining('c_0_1_glass_shard'),
      }),
    ]);
    // The advice must not be "give them distinct names": they have distinct names.
    expect(result.rejections[0]?.message).toContain('"Glass"');
    expect(result.rejections[0]?.message).toContain('"Glass Shard"');
  });

  it('leaves one name describing two token shapes to the DSL, not the token-script check', () => {
    // Same name, same subtype, same stats, differing in an ability the script
    // name carries no trace of. That would collide on `g_2_2_bear` too, and the
    // export check never sees it: `DUPLICATE_TOKEN_NAME` is the earlier and more
    // specific report, and one name describing two tokens is already broken for
    // the card registry and the art manifest whatever Forge would have done.
    const a = spell('Bear Call', [
      {
        kind: 'createToken',
        count: 1,
        token: { name: 'Bear', power: 2, toughness: 2, colors: ['R'], subtypes: ['Bear'], keywords: [] },
      },
    ]);
    const b = spell('Hasty Bear Call', [
      {
        kind: 'createToken',
        count: 1,
        token: {
          name: 'Bear',
          power: 2,
          toughness: 2,
          colors: ['R'],
          subtypes: ['Bear'],
          keywords: [],
          abilities: [
            {
              kind: 'triggered',
              condition: 'selfDies',
              effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
            },
          ],
        },
      },
    ]);
    const result = transpileSet([a, b], EDITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toStrictEqual(['DSL_VIOLATION']);
    expect(result.rejections[0]?.message).toContain('DUPLICATE_TOKEN_NAME');
    expect(result.rejections[0]?.message).toContain('"Bear"');
  });

  it('rejects a card belonging to a different set code', () => {
    const home = spell('Home Card', [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }]);
    const foreign = parseCard({
      kind: 'instant',
      id: 'oth-foreign-card',
      name: 'Foreign Card',
      rarity: 'common',
      set: { code: 'OTH', collectorNumber: 1 },
      manaCost: { generic: 1, R: 1 },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: 4, target: { kind: 'targetCreature' } }],
    });
    const result = transpileSet([home, foreign], EDITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.path).toBe('set.code');
  });

  it('deduplicates identical tokens shared by two cards', () => {
    const token = {
      name: 'Bear',
      power: 2,
      toughness: 2,
      colors: ['R'],
      subtypes: ['Bear'],
      keywords: [],
    } satisfies TokenSpec;
    const a = spell('First Call', [{ kind: 'createToken', count: 1, token }]);
    const b = spell('Second Call', [{ kind: 'createToken', count: 2, token }]);
    const result = transpileSet([a, b], EDITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokens.map((file) => file.path)).toEqual(['tokens/r_2_2_bear.txt']);
  });
});
