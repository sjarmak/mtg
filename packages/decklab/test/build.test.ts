import { afterEach, describe, expect, it } from 'vitest';
import { closeStore, type DataStore } from '@mtg/data';
import { buildInformedDeck, EmptyUniverseError } from '../src/build';
import type { DeckProposal } from '../src/select';
import { roundsCeiling } from '../src/select';
import { createFakeStore, fillerSpells, SAMPLE_CARDS } from './support/fake-store';
import { scriptedProvider } from './support/scripted-provider';

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

const CRITERIA = {
  prompt: 'aggressive red deck',
  format: 'modern' as const,
  colors: ['R' as const],
  archetype: 'aggro',
  size: 60,
  landCount: 24,
};

describe('buildInformedDeck', () => {
  it('builds a deck whose every inclusion cites a stated criterion', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn them out',
        cards: [
          { name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Monastery Swiftspear', count: 4, criteria: ['archetype'], reason: 'pressure' },
        ],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: 1 });

    expect(built.deck.spells).toHaveLength(2);
    for (const inclusion of built.deck.spells) {
      expect(inclusion.criteria.length).toBeGreaterThan(0);
      for (const id of inclusion.criteria) {
        expect(['format', 'colors', 'archetype']).toContain(id);
      }
    }
    expect(built.deck.manaBase.basics.R).toBe(24);
    expect(built.report).toContain('Lightning Bolt');
  });

  it('feeds a rejection back and accepts the replacement on the next round', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [{ name: 'Bolt of Lightning', count: 4, criteria: ['archetype'], reason: 'made up' }],
      },
      {
        plan: 'burn',
        cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'real' }],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: 2 });

    // Three rounds against a two-round budget: round two accepted four spells,
    // which buys another round (mtg-bc2.49), and round three re-proposes what is
    // already in the deck, which ends the loop.
    expect(built.rounds).toBe(3);
    expect(provider.prompts[1]).toContain('Bolt of Lightning');
    expect(provider.prompts[1]).toContain('not a card in the store');
    expect(built.deck.spells.map((entry) => entry.card.name)).toEqual(['Lightning Bolt']);
  });

  it('tells the model a card is already in the deck rather than accepting it twice', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: 2 });

    expect(provider.prompts[1]).toContain('do not propose these again');
    expect(built.deck.spells).toHaveLength(1);
  });

  it('returns a partial deck and names what is missing rather than throwing', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: 1 });

    expect(built.deck.totalCards).toBe(28);
    expect(built.deck.shortfalls.some((line) => line.includes('target of 60'))).toBe(true);
  });

  it('refuses to build when no card satisfies the criteria', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([{ plan: '', cards: [] }]);

    await expect(
      buildInformedDeck({
        store,
        provider,
        criteria: { ...CRITERIA, budget: { maxCardUsd: 0.01 } },
      }),
    ).rejects.toThrow(EmptyUniverseError);
  });

  it('reports the model plan and the size of the pool it chose from', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn them out fast',
        cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: 1 });

    expect(built.plan).toBe('burn them out fast');
    expect(built.report).toContain('burn them out fast');
    expect(built.report).toContain(`Chosen from ${built.universeSize} cards`);
  });
});

/**
 * mtg-bc2.40. The lab used to ask for non-land cards only, so nonbasic lands
 * were never proposed and every deck ran a mana base of pure basics. A blind
 * comparison lost on quality 2-4 with the judge naming the all-basics mana base
 * in almost every loss.
 */
describe('nonbasic lands are the model to choose', () => {
  const BOROS = { ...CRITERIA, prompt: 'boros aggro', colors: ['R' as const, 'W' as const] };

  it('asks for nonbasic lands and says the basics are not the model to pick', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
      },
    ]);

    await buildInformedDeck({ store, provider, criteria: BOROS, maxRounds: 1 });

    const prompt = provider.prompts[0] ?? '';
    expect(prompt).toContain('nonbasic lands');
    expect(prompt).toContain('Do not name basic lands');
    expect(prompt).toContain('room for 24 more nonbasic lands');
  });

  it('plays a dual the model chose and counts it as a source', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'boros',
        cards: [
          { name: 'Boros Charm', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Sacred Foundry', count: 4, criteria: ['archetype'], reason: 'fixing' },
        ],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: BOROS, maxRounds: 1 });

    expect(built.deck.lands.map((entry) => entry.card.name)).toEqual(['Sacred Foundry']);
    expect(built.deck.manaBase.nonBasicLands).toBe(4);
    expect(built.deck.manaBase.nonBasicSources.R).toBe(4);
    expect(built.deck.manaBase.nonBasicSources.W).toBe(4);
    expect(built.deck.manaBase.basics.R + built.deck.manaBase.basics.W).toBe(20);
    expect(built.deck.manaBase.totalLands).toBe(24);
  });

  it('does not spend the spell target on lands', async () => {
    // Four lands and four spells against a 36-spell target: the deck is 32
    // spells short, not 28, because the lands came out of the land slot.
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'boros',
        cards: [
          { name: 'Boros Charm', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Sacred Foundry', count: 4, criteria: ['archetype'], reason: 'fixing' },
        ],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: BOROS, maxRounds: 2 });

    expect(built.deck.spells.reduce((sum, entry) => sum + entry.count, 0)).toBe(4);
    expect(built.deck.totalCards).toBe(28);
    // Round two still asks for the 32 spells that are missing, not 28.
    expect(provider.prompts[1] ?? '').toContain('Choose 32 more non-land cards');
  });

  it('shows in the report where each color source comes from', async () => {
    // "20 sources" reads the same for twenty Mountains and for twelve plus
    // eight duals, and a human comparing two mana bases needs to tell those
    // apart. The judge sees only a flat decklist, so this is for the reader.
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'boros',
        cards: [
          { name: 'Boros Charm', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Sacred Foundry', count: 4, criteria: ['archetype'], reason: 'fixing' },
        ],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: BOROS, maxRounds: 1 });

    expect(built.report).toContain('| color | pips | weighted demand | basics | nonbasic | sources |');
    expect(built.report).toContain('## Nonbasic lands');
    expect(built.report).toContain('4x Sacred Foundry');
  });

  it('prints the criteria a nonbasic land cites, the way it prints a spell’s', async () => {
    // A dual is a choice like any other and carries its citations through
    // verification. Printing only its reason left half of some decks' choices
    // looking untraced in the one report the clause is supposed to be visible in.
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'boros',
        cards: [
          { name: 'Boros Charm', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Sacred Foundry', count: 4, criteria: ['colors'], reason: 'fixing' },
        ],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: BOROS, maxRounds: 1 });

    const lands = built.report.split('## Nonbasic lands')[1] ?? '';
    expect(lands).toContain('- **4x Sacred Foundry**');
    expect(lands).toContain('- cites: `colors`');
    expect(lands).toContain('- fixing');
  });

  it('rejects a basic by name and tells the model why', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [
          { name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Mountain', count: 20, criteria: ['archetype'], reason: 'mana' },
        ],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: 2 });

    expect(built.rejections.some((entry) => entry.code === 'basic-land')).toBe(true);
    expect(provider.prompts[1] ?? '').toContain('is a basic land');
    expect(built.deck.lands).toEqual([]);
  });

  it('cuts lands past the slot rather than shipping an oversized deck', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'boros',
        cards: [
          { name: 'Boros Charm', count: 4, criteria: ['archetype'], reason: 'reach' },
          { name: 'Sacred Foundry', count: 4, criteria: ['archetype'], reason: 'fixing' },
          { name: 'Mishra’s Factory', count: 4, criteria: ['archetype'], reason: 'land' },
        ],
      },
    ]);

    const built = await buildInformedDeck({
      store,
      provider,
      criteria: { ...BOROS, landCount: 4 },
      maxRounds: 1,
    });

    expect(built.deck.manaBase.nonBasicLands).toBe(4);
    expect(built.rejections.some((entry) => entry.code === 'over-land-slot')).toBe(true);
  });
});

/**
 * mtg-bc2.49. A budget-pauper build came back with 58 cards against a stated 60
 * because the loop had spent its three rounds while the model was still filling
 * the deck. A deck that ends short is a legitimate answer when the pool cannot
 * fill it; ending short because the rounds ran out is not, and either way the
 * report has to say how short and what was in the way.
 */
describe('a deck that ends short says so, and by how much', () => {
  it('fills the deck when the model needs more rounds than the guarantee', async () => {
    // Eight spells a round for four rounds, four in the fifth: 36 spells and 24
    // lands, reached two rounds after the guaranteed budget runs out.
    store = createFakeStore(fillerSpells(12));
    const provider = scriptedProvider(
      [
        ['Ember Bolt 1', 'Ember Bolt 2'],
        ['Ember Bolt 3', 'Ember Bolt 4'],
        ['Ember Bolt 5', 'Ember Bolt 6'],
        ['Ember Bolt 7', 'Ember Bolt 8'],
        ['Ember Bolt 9'],
      ].map((names) => ({
        plan: 'burn',
        cards: names.map((name) => ({ name, count: 4, criteria: ['archetype'], reason: 'reach' })),
      })),
    );

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA });

    expect(built.rounds).toBe(5);
    expect(built.deck.totalCards).toBe(60);
    expect(built.shortBy).toBe(0);
    expect(built.deck.shortfalls.some((line) => line.includes('target of 60'))).toBe(false);
    expect(built.report).not.toContain('card selection ended');
  });

  it('names how many spells are missing and what was still in the way', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [{ name: 'Bolt of Lightning', count: 4, criteria: ['archetype'], reason: 'made up' }],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA });

    expect(built.shortBy).toBe(36);
    expect(built.report).toContain('card selection ended 36 spells short of the target');
    expect(built.report).toContain('still blocked by: unknown-card');
    // Two of the three guaranteed rounds, because round two repeated round one's
    // rejection exactly and the third would have asked the same question again.
    expect(built.rounds).toBe(2);
  });

  it('does not invent a blocker when the model simply repeated itself', async () => {
    // mtg-bc2.90. Round two re-proposed what the deck already held and named no
    // problem, so the loop stops inside its guarantee rather than buy a third
    // round of the identical question. Nothing was rejected, and the report must
    // not imply otherwise.
    store = createFakeStore(fillerSpells(4));
    const provider = scriptedProvider([
      {
        plan: 'burn',
        cards: [{ name: 'Ember Bolt 1', count: 4, criteria: ['archetype'], reason: 'reach' }],
      },
    ]);

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA });

    expect(built.rejections).toEqual([]);
    expect(built.rounds).toBe(2);
    expect(built.shortBy).toBe(32);
    expect(built.report).toContain('the next round would have asked an identical question');
    expect(built.report).not.toContain('still blocked by');
  });

  it('names the round ceiling rather than accusing the model that was still proposing', async () => {
    // The report's job when the rounds run out mid-fill. "Nothing was rejected,
    // so the model stopped proposing" is a falsehood here: it proposed a fresh
    // legal card on every round including the last, and would have on the next.
    store = createFakeStore(fillerSpells(20));
    const provider = scriptedProvider(oneFreshCardPerRound(20));

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA });

    const ceiling = roundsCeiling(36);
    expect(built.rounds).toBe(ceiling);
    expect(built.rejections).toEqual([]);
    expect(built.report).toContain(`card selection ended ${36 - ceiling} spells short of the target`);
    expect(built.report).toContain(`${ceiling}-round ceiling`);
    expect(built.report).not.toContain('the model stopped proposing');
  });

  it('does not blame a rejection that rode along when the rounds are what ran out', async () => {
    // The typo is repeated every round and costs the deck nothing; the ceiling
    // costs it two dozen spells. Naming the typo sends the reader hunting for a
    // card-name problem instead of asking for more rounds.
    store = createFakeStore(fillerSpells(20));
    const provider = scriptedProvider(
      oneFreshCardPerRound(20).map((answer) => ({
        plan: answer.plan,
        cards: [
          ...answer.cards,
          { name: 'Lightnign Bolt', count: 1, criteria: ['archetype'], reason: 'typo' },
        ],
      })),
    );

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA });

    expect(built.rejections.map((entry) => entry.code)).toEqual(['unknown-card']);
    expect(built.report).toContain(`${roundsCeiling(36)}-round ceiling`);
    expect(built.report).not.toContain('still blocked by');
  });

  it('names the dollars when what ran out is the money, not the rounds', async () => {
    // mtg-bc2.89. Every round proposes a fresh legal card, so no round bound is
    // anywhere near binding — nine of the twelve the ceiling grants are still
    // unspent. Reporting a round count here would send the reader to raise the
    // one limit that was never in the way.
    store = createFakeStore(fillerSpells(20));
    const provider = scriptedProvider(oneFreshCardPerRound(20), { costUsd: 0.9 });

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxSpendUsd: 2 });

    expect(built.rounds).toBe(3);
    expect(built.report).toContain('the $2.00 it was allowed to spend on model calls, at $2.70');
    expect(built.report).not.toContain('round ceiling');
  });

  it('names the caller’s own round budget when that is the binding one', async () => {
    // A budget stated above the ceiling is a spend already agreed to, so it is
    // that number the reader has to see, not the cap it overrode.
    store = createFakeStore(fillerSpells(20));
    const stated = roundsCeiling(36) + 2;
    const provider = scriptedProvider(oneFreshCardPerRound(20));

    const built = await buildInformedDeck({ store, provider, criteria: CRITERIA, maxRounds: stated });

    expect(built.rounds).toBe(stated);
    expect(built.report).toContain(`the stated budget of ${stated} rounds ran out`);
  });
});

/** One new legal spell per round and nothing else: progress that never stops. */
function oneFreshCardPerRound(rounds: number): readonly DeckProposal[] {
  return Array.from({ length: rounds }, (_unused, index) => ({
    plan: 'burn',
    cards: [{ name: `Ember Bolt ${index + 1}`, count: 1, criteria: ['archetype'], reason: 'reach' }],
  }));
}

/**
 * mtg-bc2.47. The land count was frozen in code — 24 by default, a constant per
 * eval scenario — so a burn request came back with 24 lands and the blind judge
 * named exactly that as why the informed deck lost: "Deck A's 24 lands ... dilute
 * burn density and invite flood". How many lands a deck wants follows from its
 * curve and its plan, which is a judgment; the split between colors does not,
 * and stays arithmetic.
 */
describe('the land count is a judgment, not a constant', () => {
  const UNSTATED = {
    prompt: 'aggressive mono-red burn that wins by turn five',
    format: 'modern' as const,
    colors: ['R' as const],
    archetype: 'aggro',
    size: 60,
  };

  const BURN_PLAN = {
    landCount: 19,
    reason: 'burn wants the extra spell more than the extra land',
  };

  const BOLTS = {
    plan: 'burn them out',
    cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
  };

  it('builds to the count the model chose when the player stated none', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([BURN_PLAN, BOLTS]);

    const built = await buildInformedDeck({ store, provider, criteria: UNSTATED, maxRounds: 1 });

    expect(built.landPlan.count).toBe(19);
    expect(built.landPlan.source).toBe('model');
    expect(built.deck.manaBase.totalLands).toBe(19);
    expect(built.deck.manaBase.basics.R).toBe(19);
  });

  it('sizes the spell target off the chosen count, not off twenty-four', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([BURN_PLAN, BOLTS]);

    await buildInformedDeck({ store, provider, criteria: UNSTATED, maxRounds: 1 });

    // Prompt 0 is the land plan; prompt 1 is the card selection that follows it.
    expect(provider.prompts[1] ?? '').toContain('Choose 41 more non-land cards');
    expect(provider.prompts[1] ?? '').toContain('41 non-land cards and 19 lands');
  });

  it('says in the report where the number came from', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([BURN_PLAN, BOLTS]);

    const built = await buildInformedDeck({ store, provider, criteria: UNSTATED, maxRounds: 1 });

    expect(built.report).toContain(
      '19 lands, chosen for this deck: burn wants the extra spell more than the extra land',
    );
  });

  it('lets a stated count win outright, without asking the model for one', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([BOLTS]);

    const built = await buildInformedDeck({
      store,
      provider,
      criteria: { ...UNSTATED, landCount: 24 },
      maxRounds: 1,
    });

    expect(built.landPlan.source).toBe('stated');
    expect(built.deck.manaBase.totalLands).toBe(24);
    // No land-plan call was made, so the very first prompt is the selection.
    expect(provider.prompts[0] ?? '').toContain('Choose 36 more non-land cards');
    expect(built.report).toContain('24 lands, as the player stated.');
  });
});
