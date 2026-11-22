import { describe, expect, it } from 'vitest';
import {
  MAX_CARD_ID_LENGTH,
  MAX_DRAFT_SEED_LENGTH,
  MAX_HUMAN_PICKS,
  MAX_PICK_LOG_LENGTH,
  encodePickLog,
  readDraftInputs,
} from '../../src/routes/draft/params';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DRAFTMANCER_SIMPLE_BOT_POLICY } from '@mtg/draft-export';

describe('draft route input boundary', () => {
  it('round-trips a bounded seed and pick transcript', () => {
    const picks = ['set-one', 'set-two'];
    expect(
      readDraftInputs(
        { seed: 'draft/one', picks: encodePickLog(picks), bot: DEFAULT_NATIVE_DRAFT_BOT_POLICY },
        'fallback',
      ),
    ).toEqual({
      ok: true,
      seed: 'draft/one',
      picks,
      botPolicy: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
    });
  });

  it('replays links without a policy under the legacy bot and rejects unknown policies', () => {
    expect(readDraftInputs({ seed: 'old-link' }, 'fallback')).toEqual({
      ok: true,
      seed: 'old-link',
      picks: [],
      botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY,
    });
    expect(readDraftInputs({ seed: 'bad-link', bot: 'unknown-policy' }, 'fallback').ok).toBe(false);
  });

  it('uses the caller seed only when the URL has none', () => {
    expect(readDraftInputs({}, 'fallback/one')).toEqual({
      ok: true,
      seed: 'fallback/one',
      picks: [],
      botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY,
    });
  });

  it('bounds every attacker-controlled dimension before replay', () => {
    expect(readDraftInputs({ seed: 'x'.repeat(MAX_DRAFT_SEED_LENGTH + 1) }, 'fallback').ok).toBe(false);
    expect(readDraftInputs({ picks: 'x'.repeat(MAX_PICK_LOG_LENGTH + 1) }, 'fallback').ok).toBe(false);
    expect(
      readDraftInputs(
        { picks: encodePickLog(Array.from({ length: MAX_HUMAN_PICKS + 1 }, () => 'x')) },
        'fallback',
      ).ok,
    ).toBe(false);
    expect(
      readDraftInputs({ picks: encodePickLog(['x'.repeat(MAX_CARD_ID_LENGTH + 1)]) }, 'fallback').ok,
    ).toBe(false);
  });

  it('rejects control characters, non-arrays and non-string card ids', () => {
    expect(readDraftInputs({ seed: 'bad\nseed' }, 'fallback').ok).toBe(false);
    expect(readDraftInputs({ picks: '{}' }, 'fallback').ok).toBe(false);
    expect(readDraftInputs({ picks: '[7]' }, 'fallback').ok).toBe(false);
  });
});
