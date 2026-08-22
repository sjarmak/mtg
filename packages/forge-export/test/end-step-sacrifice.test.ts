/**
 * Arc Runner's two new vocabulary members, checked against the line Forge
 * already parses.
 *
 * Both halves were read off `res/cardsfolder` rather than reasoned out of
 * Forge's API list, so what this suite pins is a spelling the shipped corpus
 * uses on a printed card:
 *
 *   Name:Arc Runner
 *   T:Mode$ Phase | Phase$ End of Turn | TriggerZones$ Battlefield | Execute$ TrigSac | …
 *   SVar:TrigSac:DB$ Sacrifice
 *
 * Ball Lightning is the same card with trample and the explicit parameter:
 * `SVar:TrigSac:DB$ Sacrifice | SacValid$ Self`, plus `DeckHas:Ability$Sacrifice`.
 * The transpiler writes the explicit form, because Arc Runner's bare
 * `DB$ Sacrifice` leans on a default and a default is a claim that would need
 * a booted Forge to settle, while a written parameter is not.
 *
 * The load-bearing negative is `ValidPlayer$`. `beginningOfYourEndStep` writes
 * it as `You` and `beginningOfEndStep` must not write it at all — the DSL
 * condition is "the end step", any player's, and a player filter here would
 * silently narrow the exported card to something the kernel does not play.
 * Unverified against a booted Forge, exactly as the rest of this mapping is;
 * `mtg-17a` is that check and it is blocked on the Forge harness.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { legalTargetsFor, parseCard, renderOracleText } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { FORGE_TRIGGER_MODES } from '../src/vocabulary-map';
import { mustTranspile, slugId } from './helpers';

/** Arc Runner (M11 123): haste, and the end step takes it back. */
function endStepSacrificer(name: string, condition: 'beginningOfEndStep' | 'beginningOfYourEndStep'): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 3 },
    colors: ['R'],
    power: 5,
    toughness: 1,
    manaCost: { generic: 2, W: 0, U: 0, B: 0, R: 1, G: 0 },
    keywords: ['haste'],
    effects: [],
    abilities: [
      {
        kind: 'triggered',
        condition,
        effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
      },
    ],
  });
}

describe('an end-step sacrifice trigger in the Forge script', () => {
  const card = endStepSacrificer('Arc Runner', 'beginningOfEndStep');
  const script = mustTranspile(card);

  it('writes the corpus trigger mode with no player filter', () => {
    expect(script).toContain('Mode$ Phase');
    expect(script).toContain('Phase$ End of Turn');
    expect(script).not.toContain('ValidPlayer$');
  });

  it('writes the sacrifice as SacValid$ Self rather than as a defined player', () => {
    expect(script).toContain('DB$ Sacrifice');
    expect(script).toContain('SacValid$ Self');
    // `Defined$` on Forge's `Sacrifice` names the player who sacrifices, so
    // routing the retained referent through it would put a card where a player
    // belongs. This is the one effect row that drops `ctx.targeting`.
    expect(script).not.toContain('Defined$ Self');
  });

  it('declares the deck hint Ball Lightning carries', () => {
    expect(script).toContain('DeckHas:Ability$Sacrifice');
  });

  it('keeps the oracle line the printed card prints', () => {
    expect(renderOracleText(card)).toBe('Haste\nAt the beginning of the end step, sacrifice this creature.');
    expect(script).toContain(`Oracle:${renderOracleText(card)}`.replace('\n', '\\n'));
  });
});

describe('the two end-step conditions, which differ by one parameter', () => {
  it('writes ValidPlayer$ You for the controller-scoped sibling and not for this one', () => {
    const yours = mustTranspile(endStepSacrificer('Warden Runner', 'beginningOfYourEndStep'));
    expect(yours).toContain('ValidPlayer$ You');

    expect(Object.fromEntries(FORGE_TRIGGER_MODES.beginningOfEndStep)).toEqual({
      Mode: 'Phase',
      Phase: 'End of Turn',
    });
  });
});

/**
 * The collector gap `sacrificeSelf` exposed, pinned on a kind that predates it.
 *
 * `DeckHas` hints were read off `card.effects` only, so every hint-carrying
 * effect written as a triggered or activated ability exported without one.
 * `sacrificeSelf` cannot sit in `card.effects` at all -- both its legal targets
 * are retained referents -- so the gap had to close for its row to mean
 * anything, and closing it fixes `gainLife` and `createToken` in the same
 * place.
 */
describe('the deck hint on an ability effect rather than a spell effect', () => {
  it('declares LifeGain for a life gain hung off a trigger', () => {
    const card = parseCard({
      kind: 'creature',
      id: slugId('Hint Warden'),
      name: 'Hint Warden',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 4 },
      colors: ['W'],
      power: 2,
      toughness: 2,
      manaCost: { generic: 2, W: 1, U: 0, B: 0, R: 0, G: 0 },
      keywords: [],
      effects: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(mustTranspile(card)).toContain('DeckHas:Ability$LifeGain');
  });
});

describe('the two legality tables, which must agree about this effect', () => {
  it('lists the one retained referent on the row and in the DSL', () => {
    expect([...FORGE_EFFECTS.sacrificeSelf.targets]).toEqual(['selfCreature']);
    expect([...legalTargetsFor('sacrificeSelf')]).toEqual(['selfCreature']);
  });
});
