/** The live table names the transformed face and exposes Siege's decline. */
import { parseCard, transformedBackFaceOf } from '@mtg/dsl';
import { scenario, type Decision, type GameState } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/routes/play/prompt';

const SIEGE = parseCard({
  kind: 'battle',
  id: 'play-siege',
  name: 'Invasion of Prompts',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 201 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Siege'],
  defense: 4,
  backFace: {
    kind: 'creature',
    name: 'Prompt Unbound',
    colors: ['U'],
    subtypes: ['Wizard'],
    power: 4,
    toughness: 4,
  },
});

describe('Siege free-cast prompt', () => {
  it('offers the transformed name and the legal leave-in-exile answer', () => {
    if (SIEGE.kind !== 'battle') throw new Error('fixture is not a Battle');
    const back = transformedBackFaceOf(SIEGE);
    if (back === null) throw new Error('fixture has no back face');
    const opened = scenario({ hands: [[SIEGE], []] }).state;
    const oid = opened.players[0].hand[0];
    if (oid === undefined) throw new Error('fixture has no object');
    const state: GameState = {
      ...opened,
      pendingFreeCast: {
        player: 0,
        oid,
        from: 'exile',
        card: back,
        optional: true,
        sourceOid: oid,
        controller: 0,
        remaining: [],
        x: null,
        objectToGraveyard: null,
        tally: { exiled: 0, exiledPermanents: 0, damage: 0, lifeLost: 0 },
        deferredTriggers: [],
      },
    };
    const decision: Decision = {
      kind: 'freeCast',
      player: 0,
      oid,
      optional: true,
      options: [
        { type: 'declineFreeCast', player: 0, oid },
        { type: 'castSpell', player: 0, oid, targets: [], castingCost: 'withoutMana' },
      ],
      complete: true,
    };

    const prompt = buildPrompt(state, decision, ['You', 'Bot']);
    expect(prompt.headline).toBe('Cast transformed or leave in exile');
    expect(prompt.explain).toContain('may cast the transformed card');
    expect(prompt.choices.map((choice) => choice.label)).toEqual([
      'Leave Prompt Unbound in exile',
      'Cast Prompt Unbound',
    ]);
  });
});
