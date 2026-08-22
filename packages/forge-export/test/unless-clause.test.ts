/**
 * An "unless its controller pays {2}" spell has a real Forge mapping, so it
 * exports rather than being rejected.
 *
 * `UnlessCost$`/`UnlessPayer$` are ability-line parameters Forge applies ahead
 * of the effect API, verified against `res/cardsfolder` in Forge 2.0.14: 718
 * lines carry `UnlessCost$`, 27 name `UnlessPayer$ TargetedController` and 20
 * name `UnlessPayer$ Targeted`. That is why this file asserts a script and
 * `modal-spell.test.ts` asserts a rejection — the difference between the two
 * shapes is whether Forge already has the grammar, not how hard the DSL side
 * was.
 *
 * The `SpellDescription$` matters as much as the parameters. Forge prints it
 * verbatim in the card detail pane, and a description that omits the toll would
 * describe unconditional removal to a human reading a card that is not.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function decree(unless: unknown, effects: readonly unknown[]): ReturnType<typeof transpileCardScript> {
  return transpileCardScript(
    parseCard({
      kind: 'instant',
      id: 'tst-royal-decree',
      name: 'Royal Decree',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      effects,
      unless,
    }),
  );
}

function abilityLine(result: ReturnType<typeof transpileCardScript>): string {
  if (!result.ok) throw new Error(`expected a script, got ${JSON.stringify(result.rejections)}`);
  const line = result.value.lines.find((text) => text.startsWith('A:'));
  if (line === undefined) throw new Error(`no ability line in ${result.value.lines.join(' / ')}`);
  return line;
}

describe('an "unless" clause on the Forge boundary', () => {
  it("charges the target permanent's controller", () => {
    const line = abilityLine(
      decree({ payer: 'targetController', cost: { generic: 2 } }, [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
      ]),
    );
    expect(line).toContain('UnlessCost$ 2');
    expect(line).toContain('UnlessPayer$ TargetedController');
  });

  it('charges the targeted player themselves', () => {
    const line = abilityLine(
      decree({ payer: 'targetPlayer', cost: { generic: 1, U: 1 } }, [
        { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
      ]),
    );
    expect(line).toContain('UnlessCost$ 1 U');
    expect(line).toContain('UnlessPayer$ Targeted');
  });

  it('prints the toll in the description Forge shows a human', () => {
    const line = abilityLine(
      decree({ payer: 'targetController', cost: { generic: 2 } }, [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
      ]),
    );
    expect(line).toContain('SpellDescription$ Destroy target creature unless its controller pays {2}.');
  });

  it('leaves a spell without the clause carrying neither parameter', () => {
    const result = transpileCardScript(
      parseCard({
        kind: 'instant',
        id: 'tst-plain-decree',
        name: 'Plain Decree',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 2 },
        manaCost: { generic: 1, W: 1 },
        colors: ['W'],
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      }),
    );
    expect(abilityLine(result)).not.toContain('Unless');
  });
});

describe('a "you may" spell on the Forge boundary', () => {
  it('is refused, because a spell-wide "may" is written per effect API in Forge', () => {
    const result = transpileCardScript(
      parseCard({
        kind: 'sorcery',
        id: 'tst-offered-mercy',
        name: 'Offered Mercy',
        rarity: 'uncommon',
        set: { code: 'TST', collectorNumber: 3 },
        manaCost: { generic: 2, G: 1 },
        colors: ['G'],
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        may: 'you',
      }),
    );
    expect(result).toEqual({
      ok: false,
      rejections: [
        expect.objectContaining({ code: 'UNMAPPED_MAY_SPELL', cardId: 'tst-offered-mercy', path: 'may' }),
      ],
    });
  });
});
