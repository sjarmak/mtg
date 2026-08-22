/**
 * The mapping under a click, checked against a prompt written out by hand.
 *
 * `choicesByObject` is what makes a card on the table clickable, so a grouping
 * that drifts sends a click to a neighboring move: still legal, still a game
 * that plays on, and the wrong card played. The expected pairs below are
 * literals written beside a literal prompt, never a second call to the function
 * under test. A test that built its expectation by calling `choicesByObject`
 * would agree with any mapping that function produced, including a wrong one,
 * which is the hole this file exists to close.
 *
 * No kernel and no render: the input is four stated choices, so every pair here
 * has an answer that can be read off the page.
 */
import { describe, expect, it } from 'vitest';
import { choicesByObject } from '../../src/routes/play/prompt';
import type { PlayChoice, PlayPrompt } from '../../src/routes/play/prompt';

/** Names no object, so nothing on the table can offer it. */
const PASS: PlayChoice = { index: 0, label: 'Pass', detail: null, kind: 'passPriority', oids: [] };

/** One spell, two legal aims: the case that opens a picker instead of playing. */
const AIM_AT_BEAR: PlayChoice = {
  index: 1,
  label: 'Cast Lash at Bear',
  detail: null,
  kind: 'castSpell',
  oids: ['lash'],
};
const AIM_AT_OGRE: PlayChoice = {
  index: 2,
  label: 'Cast Lash at Ogre',
  detail: null,
  kind: 'castSpell',
  oids: ['lash'],
};

/**
 * One choice naming the same object in two of its slots. `orderBlockers` lists
 * an attacker beside each of its blockers, and a pair of identical blockers is
 * the shape that would put one option in a picker twice.
 */
const ORDER: PlayChoice = {
  index: 3,
  label: 'Bear: Ogre, Ogre',
  detail: null,
  kind: 'orderBlockers',
  oids: ['bear', 'ogre', 'ogre'],
};

const STATED: PlayPrompt = {
  headline: 'Priority',
  explain: 'A prompt written out rather than enumerated.',
  choices: [PASS, AIM_AT_BEAR, AIM_AT_OGRE, ORDER],
  truncated: false,
};

describe('every offered choice that acts on a given object', () => {
  it('is the pair list written out beside the prompt, entry for entry', () => {
    expect([...choicesByObject(STATED)]).toEqual([
      ['lash', [AIM_AT_BEAR, AIM_AT_OGRE]],
      ['bear', [ORDER]],
      ['ogre', [ORDER]],
    ]);
  });

  it('holds the prompt own choices, indices included, not copies of them', () => {
    const aims = choicesByObject(STATED).get('lash') ?? [];
    expect(aims[0]).toBe(AIM_AT_BEAR);
    expect(aims[1]).toBe(AIM_AT_OGRE);
    expect(aims.map((choice) => choice.index)).toEqual([1, 2]);
  });

  it('lists a choice once however many of its slots name the same object', () => {
    expect(choicesByObject(STATED).get('ogre')).toEqual([ORDER]);
  });

  it('leaves a choice that names no object out of the map', () => {
    expect([...choicesByObject(STATED).keys()]).toEqual(['lash', 'bear', 'ogre']);
  });
});
