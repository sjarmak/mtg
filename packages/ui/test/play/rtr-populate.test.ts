/** The play surface exposes Populate as a clickable battlefield choice. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Decision } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { buildPrompt, choicesByObject } from '../../src/routes/play/prompt';

const TOKEN = parseCard({
  kind: 'creature',
  id: 'play-populate-token',
  name: 'Bird Token',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { W: 1 },
  colors: ['W'],
  subtypes: ['Bird'],
  power: 1,
  toughness: 1,
  keywords: ['flying'],
});

describe('Populate prompt', () => {
  it('names and maps each token option to its battlefield object', () => {
    const state = scenario({ battlefield: [{ card: TOKEN, controller: 0, token: true }] }).state;
    const token = state.battlefield[0];
    if (token === undefined) throw new Error('Populate prompt board is incomplete');
    const decision: Extract<Decision, { kind: 'populate' }> = {
      kind: 'populate',
      player: 0,
      tokens: [token],
      options: [{ type: 'choosePopulateToken', player: 0, token }],
      complete: true,
    };

    const prompt = buildPrompt(state, decision, ['You', 'Bot']);
    expect(prompt).toMatchObject({
      headline: 'Populate',
      choices: [{ kind: 'choosePopulateToken', label: 'Copy Bird Token', oids: [token] }],
    });
    expect(choicesByObject(prompt).get(token)).toEqual(prompt.choices);
  });
});
