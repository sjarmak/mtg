/** Human-play prompts for M13's bounded top-library decisions. */
import { describe, expect, it } from 'vitest';
import { scenario, type Decision } from '@mtg/kernel';
import { buildPrompt } from '../../src/routes/play/prompt';

const STATE = scenario().state;
const NAMES = ['You', 'Bot'] as const;

describe('top-library play prompts', () => {
  it.each([
    [
      {
        kind: 'topLibraryOrder',
        player: 0,
        cards: ['o1'],
        options: [{ type: 'orderTopLibrary', player: 0, cards: ['o1'] }],
        complete: true,
      },
      'Order library cards',
      'orderTopLibrary',
    ],
    [
      {
        kind: 'topLibrarySelect',
        player: 0,
        cards: ['o1'],
        eligible: ['o1'],
        options: [{ type: 'selectFromTopLibrary', player: 0, chosen: 'o1', rest: [] }],
        complete: true,
      },
      'Choose a card',
      'selectFromTopLibrary',
    ],
    [
      {
        kind: 'topLibraryPartition',
        player: 1,
        cards: ['o1'],
        options: [{ type: 'separateTopLibraryPiles', player: 1, first: ['o1'], second: [] }],
        complete: true,
      },
      'Make two piles',
      'separateTopLibraryPiles',
    ],
    [
      {
        kind: 'topLibraryPile',
        player: 0,
        piles: [['o1'], []],
        options: [{ type: 'chooseTopLibraryPile', player: 0, pile: 0 }],
        complete: true,
      },
      'Choose a pile',
      'chooseTopLibraryPile',
    ],
  ] as const)('renders $kind as an actionable prompt', (decision, headline, actionType) => {
    const state =
      decision.kind === 'topLibraryPile'
        ? {
            ...STATE,
            pendingTopLibrary: {
              player: 0 as const,
              chooser: 0 as const,
              kind: 'pile' as const,
              cards: ['o1'],
              piles: [['o1'], []] as const,
              sourceOid: 'source',
              controller: 0 as const,
              remaining: [],
              x: null,
              objectToGraveyard: null,
              tally: { exiled: 0, exiledPermanents: 0, damage: 0, lifeLost: 0 },
              deferredTriggers: [],
            },
          }
        : STATE;
    const prompt = buildPrompt(state, decision as Decision, NAMES);
    expect(prompt.headline).toBe(headline);
    expect(prompt.choices).toHaveLength(1);
    expect(prompt.choices[0]?.kind).toBe(actionType);
    expect(prompt.truncated).toBe(false);
    if (decision.kind === 'topLibraryPartition') {
      expect(prompt.choices[0]?.label).toContain('Pile 1:');
      expect(prompt.choices[0]?.label).toContain('pile 2:');
    }
    if (decision.kind === 'topLibraryPile') expect(prompt.choices[0]?.oids).toEqual(['o1']);
  });
});
