/**
 * What the page states about itself, over a stated host rather than jsdom's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { REPORTED_PREFERENCE_KEYS, browserHost, gatherFeedbackContext } from '../../src/feedback/gather';
import type { FeedbackHost } from '../../src/feedback/gather';
import {
  readFeedbackSubjects,
  registerFeedbackSubject,
  resetFeedbackSubjects,
} from '../../src/feedback/subject';
import type { FeedbackSubject } from '../../src/feedback/wire';

const HOST: FeedbackHost = {
  location: { hash: '#/play/sealed', href: 'http://192.168.1.20:5320/#/play/sealed' },
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 2,
  navigator: { userAgent: 'Test/1.0' },
  document: { title: 'MTG Lab' },
};

const AT = new Date('2026-09-16T10:15:30.000Z');

const GAME: FeedbackSubject = {
  kind: 'kernel-game',
  config: { setup: { seed: 'lab-1' } },
  choices: [0, 1],
  beat: null,
  finished: false,
};

afterEach(resetFeedbackSubjects);

describe('gatherFeedbackContext', () => {
  it('states where the page was, how big, and which preferences are set', () => {
    const preferences: Record<string, string> = {
      'mtg.play.foil': 'off',
      'mtg.deck.saved': '[…]',
      'mtg.play.pace': 'brisk',
    };
    const context = gatherFeedbackContext({
      host: HOST,
      now: AT,
      readPreference: (key) => preferences[key] ?? null,
      subjects: () => [],
    });
    expect(context).toEqual({
      capturedAt: '2026-09-16T10:15:30.000Z',
      hash: '#/play/sealed',
      href: 'http://192.168.1.20:5320/#/play/sealed',
      title: 'MTG Lab',
      viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
      userAgent: 'Test/1.0',
      preferences: { 'mtg.play.foil': 'off', 'mtg.play.pace': 'brisk' },
      subject: null,
    });
    expect(REPORTED_PREFERENCE_KEYS).not.toContain('mtg.deck.saved');
  });

  it('carries the first registered subject, read at gathering time', () => {
    let choices: readonly unknown[] = [];
    const withdraw = registerFeedbackSubject(() => ({ ...GAME, choices }));
    registerFeedbackSubject(() => null);
    choices = [0, 1, 2];
    const context = gatherFeedbackContext({ host: HOST, now: AT, readPreference: () => null });
    expect(context.subject).toEqual({ ...GAME, choices: [0, 1, 2] });
    withdraw();
    expect(readFeedbackSubjects()).toEqual([]);
  });

  it('gathers what it can without a host', () => {
    const context = gatherFeedbackContext({
      host: null,
      now: AT,
      readPreference: () => null,
      subjects: () => [],
    });
    expect(context.hash).toBe('');
    expect(context.viewport).toEqual({ width: 0, height: 0, devicePixelRatio: 1 });
    expect(browserHost()).toBeNull();
  });
});
