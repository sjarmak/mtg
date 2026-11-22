import { expect, it } from 'vitest';
import catalog from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { LEGACY_CUBE_ADVISOR_MODEL as model } from '../src/advisor/legacy';
import { fixingCount, manaRisk, poolAssessment } from '../src/advisor/pool';
import { assessCard } from '../src/advisor/cards';
import { reasonsForPath } from '../src/advisor/evidence';
import { profileOf } from '../src/advisor/evidence';
import type { ObservedDraft } from '../src/advisor/state';

const card = (name: string) => catalog.cards.find((c) => c.correctedName === name)!;
const state: ObservedDraft = { seats: 8, packSize: 15, rounds: 3, picks: [], observations: [] };
it('indexes the same authored profiles without changing evaluation inputs', () => {
  expect(model.profilesByName?.size).toBe(600);
  for (const entry of catalog.cards) {
    expect(profileOf(model, entry)).toBe(model.profiles.find((p) => p.name === entry.correctedName));
  }
});
const path = (id: string, names: readonly string[]) =>
  poolAssessment(
    state,
    names.map(card),
    model,
    model.archetypes.find((a) => a.id === id)!,
  );

it('credits modal draw and a living-weapon threat without inventing reanimation', () => {
  const confluence = profileOf(model, card('Wretched Confluence'))!;
  expect(confluence.tags).toContain('card-advantage');
  expect(confluence.tags).not.toContain('reanimation');
  expect(path('control', ['Wretched Confluence']).pieces.find((p) => p.tag === 'card-advantage')?.count).toBe(
    1,
  );
  expect(profileOf(model, card('Batterskull'))!.tags).toContain('threat');
  expect(path('midrange', ['Batterskull']).pieces.find((p) => p.tag === 'threat')?.count).toBe(1);
});

it('credits Cryptbreaker as a token engine while retaining its discard role', () => {
  const profile = profileOf(model, card('Cryptbreaker'))!;
  expect(profile.tags).toEqual(expect.arrayContaining(['token-maker', 'fodder', 'discard-outlet']));
  expect(path('tokens', ['Cryptbreaker']).pieces.find((p) => p.tag === 'token-maker')?.count).toBe(1);
  expect(profile.archetypes.map((a) => a.archetype)).toEqual(
    expect.arrayContaining(['tokens', 'sacrifice', 'reanimator']),
  );
});

it('does not describe Twin plus Restoration Angel as a complete pair', () => {
  expect(path('twin-combo', ['Splinter Twin', 'Restoration Angel']).missing.some((n) => n.critical)).toBe(
    true,
  );
  expect(
    path('twin-combo', ['Kiki-Jiki, Mirror Breaker', 'Restoration Angel']).missing.some((n) => n.critical),
  ).toBe(false);
  expect(path('twin-combo', ['Splinter Twin', 'Pestermite']).missing.some((n) => n.critical)).toBe(false);
});

it('uses one compatible copy recipe instead of requiring both engines', () => {
  const pool = [card('Splinter Twin')];
  const assessment = assessCard(card('Pestermite'), pool, model, [path('twin-combo', ['Splinter Twin'])]);
  expect(assessment.synergies.some((r) => r.package === 'twin-combo')).toBe(true);
  expect(assessment.liabilities.some((r) => r.package === 'kiki-combo')).toBe(false);
});

it('recognizes real reanimation partners and missing setup rather than generic power', () => {
  const names = ['Reanimate', 'Animate Dead', 'Griselbrand', 'Archon of Cruelty'];
  const current = path('reanimator', names);
  expect(current.missing.map((n) => n.tag)).toContain('discard-outlet');
  const entomb = assessCard(card('Entomb'), names.map(card), model, [current]);
  const bomb = assessCard(card('Oko, Thief of Crowns'), names.map(card), model, [current]);
  expect(entomb.archetypeAssessments[0]!.score).toBeGreaterThan(bomb.archetypeAssessments[0]!.score);
  expect(entomb.synergies.find((r) => r.package === 'reanimate')?.cards).toContain(
    card('Griselbrand').physicalId,
  );
  expect(path('reanimator', ['Entomb', 'Liliana of the Veil']).missing.map((n) => n.tag)).toEqual(
    expect.arrayContaining(['reanimation', 'reanimation-target']),
  );
});

it('does not mistake green dorks for ramp payoffs or non-green creatures for Order fodder', () => {
  expect(
    path('ramp', ['Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Birds of Paradise']).missing.map(
      (n) => n.tag,
    ),
  ).toContain('ramp-payoff');
  expect(
    path('natural-order', ['Wall of Omens', 'Griselbrand']).pieces.find((n) => n.tag === 'green-fodder')
      ?.count,
  ).toBe(0);
});

it('counts drafted single-color sources without calling them multicolor fixing', () => {
  const pool = ['Counterspell', 'Mana Leak', 'Doom Blade', 'Go for the Throat'].map(card);
  const lands = ['Karakas', 'Cave of the Frost Dragon'].map(card);
  expect(manaRisk(card('Swords to Plowshares'), [...pool, ...lands], model)).toBeLessThan(
    manaRisk(card('Swords to Plowshares'), pool, model),
  );
  expect(fixingCount(lands, model, ['W', 'U', 'B'])).toBe(0);
});

it('keeps package explanations relevant to the chosen path', () => {
  const assessment = assessCard(card('Griselbrand'), [], model, [path('cheat', [])]);
  expect(assessment.liabilities.some((r) => r.package === 'reanimate')).toBe(true);
  const scoped = reasonsForPath(assessment.liabilities, 'cheat', model);
  expect(scoped.some((r) => r.package === 'reanimate')).toBe(false);
  expect(scoped.some((r) => r.package === 'cheat-threat')).toBe(true);
});

const whiteBlackCore = ['Swords to Plowshares', 'Wall of Omens', 'Doom Blade', 'Go for the Throat'];
it('does not let unrelated fixing hide unsupported colors in a broad midrange pool', () => {
  const result = path('midrange', [
    ...whiteBlackCore,
    'Llanowar Elves',
    'Lightning Bolt',
    'Godless Shrine',
    'Darkslick Shores',
  ]);
  expect(result.manaFeasibility).toBe('Needs fixing');
  expect(result.reasons.find((r) => r.code === 'unsupported-mana-colors')).toMatchObject({
    polarity: 'negative',
    cards: expect.arrayContaining([card('Llanowar Elves').physicalId, card('Lightning Bolt').physicalId]),
    text: expect.stringContaining('G, R'),
  });
});

it('allows a two-color subset of midrange without demanding its other usual colors', () => {
  const result = path('midrange', [...whiteBlackCore, 'Godless Shrine']);
  expect(result.manaFeasibility).toBe('Comfortable');
  expect(result.reasons.some((r) => r.code === 'unsupported-mana-colors')).toBe(false);
});

it('requires sources for the actual splash rather than counting every dual land', () => {
  const pool = [...whiteBlackCore, 'Lightning Bolt', 'Godless Shrine'];
  expect(path('midrange', [...pool, 'Darkslick Shores']).manaFeasibility).toBe('Needs fixing');
  const fixed = path('midrange', [...pool, 'Blood Crypt', 'Sacred Foundry']);
  expect(fixed.manaFeasibility).toBe('Comfortable');
  expect(fixed.reasons.some((r) => r.code === 'unsupported-mana-colors')).toBe(false);
});

it('does not use splash-colored accelerators to prove their own castability', () => {
  const result = path('midrange', [
    ...whiteBlackCore,
    'Gideon, Ally of Zendikar',
    'Liliana of the Veil',
    'Llanowar Elves',
    'Elvish Mystic',
    'Godless Shrine',
  ]);
  expect(result.manaFeasibility).toBe('Needs fixing');
  expect(result.reasons.find((r) => r.code === 'unsupported-mana-colors')?.text).toContain('G lack');
});
