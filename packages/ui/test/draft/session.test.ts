// @vitest-environment jsdom
/**
 * The draft you were in the middle of, and the two ways it stops being that one.
 *
 * `mtg-tewc.7`. What is stored is a seed and the picks, because everything else
 * — the packs, the seven bots, the passing — is a function of the set and the
 * seed (`../../src/routes/draft/draft-session.ts`). So the claims worth making
 * are the refusals: a set that moved underneath the seed, and a pick list that
 * no longer replays against the pack it named.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  DEFAULT_NATIVE_DRAFT_BOT_POLICY,
  DRAFTMANCER_SIMPLE_BOT_POLICY,
  runHumanDraft,
} from '@mtg/draft-export';
import {
  clearDraftSession,
  DRAFT_SESSION_KEY,
  DRAFT_SESSION_VERSION,
  readDraftSession,
  resumeDraft,
  writeDraftSession,
} from '../../src/routes/draft/draft-session';
import { writeStored } from '../../src/routes/deck/local-store';

afterEach(() => {
  clearDraftSession();
});

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const SEED = 'draft-session-test';

function packIds(seed: string): readonly string[] {
  return runHumanDraft(SET, { seed }).nextPick?.cards.map((card) => card.id) ?? [];
}

describe('the stored draft', () => {
  it('uses stable policy identifiers across the runtime and stored document', () => {
    expect(DEFAULT_NATIVE_DRAFT_BOT_POLICY).toBe('native-deck-conditioned/v1');
    expect(DRAFTMANCER_SIMPLE_BOT_POLICY).toBe('draftmancer-simple/v1');
  });

  it('is a seed and a pick list, read back as written', () => {
    expect(writeDraftSession(SEED, ['a', 'b'], ['a', 'b', 'c'])).toBe(true);
    expect(readDraftSession()).toEqual({
      version: DRAFT_SESSION_VERSION,
      seed: SEED,
      picks: ['a', 'b'],
      packIds: ['a', 'b', 'c'],
      botPolicy: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
    });
  });

  it('migrates a version-one session onto the legacy policy that originally made its bot picks', () => {
    const legacyPack =
      runHumanDraft(SET, { seed: SEED, botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY }).nextPick?.cards.map(
        (card) => card.id,
      ) ?? [];
    writeStored(
      DRAFT_SESSION_KEY,
      JSON.stringify({ version: 1, seed: SEED, picks: [], packIds: legacyPack }),
    );

    const session = readDraftSession();
    expect(session?.botPolicy).toBe(DRAFTMANCER_SIMPLE_BOT_POLICY);
    if (session === null) throw new Error('the legacy session was not read');
    expect(resumeDraft(session, SET).ok).toBe(true);
  });

  it('is nothing when there is none, when it is not JSON, or when it is at another version', () => {
    expect(readDraftSession()).toBeNull();
    writeStored(DRAFT_SESSION_KEY, 'not json');
    expect(readDraftSession()).toBeNull();
    writeStored(
      DRAFT_SESSION_KEY,
      JSON.stringify({ version: DRAFT_SESSION_VERSION + 1, seed: SEED, picks: [], packIds: ['a'] }),
    );
    expect(readDraftSession()).toBeNull();
  });

  it('is forgotten outright', () => {
    writeDraftSession(SEED, [], ['a']);
    clearDraftSession();
    expect(readDraftSession()).toBeNull();
  });
});

describe('reopening it against the set on the page', () => {
  it('replays a real transcript and says how long the whole draft is', () => {
    const opened = packIds(SEED);
    const first = opened[0];
    if (first === undefined) throw new Error('the fixture set cannot fill a pack');
    writeDraftSession(SEED, [first], opened);
    const session = readDraftSession();
    if (session === null) throw new Error('the session was not stored');
    const resumed = resumeDraft(session, SET);
    if (!resumed.ok) throw new Error(`resume refused: ${resumed.problem.kind}`);
    expect(resumed.seed).toBe(SEED);
    expect(resumed.picks).toEqual([first]);
    expect(resumed.totalPicks).toBe(opened.length * runHumanDraft(SET, { seed: SEED }).rounds);
  });

  it('offers a draft that was stored before its first pick', () => {
    writeDraftSession(SEED, [], packIds(SEED));
    const session = readDraftSession();
    if (session === null) throw new Error('the session was not stored');
    const resumed = resumeDraft(session, SET);
    expect(resumed.ok).toBe(true);
  });

  /**
   * The guard doing its job: the same seed over a different set opens a
   * different pack, and replaying ids against it would either fail or, worse,
   * succeed against cards nobody chose.
   */
  it('refuses a pack this set no longer deals', () => {
    writeDraftSession(SEED, [], ['a card this set does not hold']);
    const session = readDraftSession();
    if (session === null) throw new Error('the session was not stored');
    const resumed = resumeDraft(session, SET);
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.problem.kind).toBe('set-changed');
  });

  it('refuses a pick the pack it opens does not contain, with the reason', () => {
    const opened = packIds(SEED);
    writeDraftSession(SEED, ['not-in-this-pack'], opened);
    const session = readDraftSession();
    if (session === null) throw new Error('the session was not stored');
    const resumed = resumeDraft(session, SET);
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.problem.kind).toBe('transcript');
    if (resumed.problem.kind !== 'transcript') return;
    expect(resumed.problem.message).not.toBe('');
  });
});
