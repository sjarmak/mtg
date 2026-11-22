/**
 * The one function every Play section asks whether a cell is live.
 *
 * `mtg-a982g.1`. Pinned as a table of facts rather than through a render,
 * because the render tests (`./opponent-choice.test.ts`, `./play-chooser.test.ts`)
 * pin how a cell is drawn and this is what they draw.
 */
import { describe, expect, it } from 'vitest';
import {
  availability,
  COMMANDER_UNAVAILABLE_REASON,
  CUBE_DRAFT_ONLY_REASON,
  opponentOf,
  PRINTED_DRAFT_UNAVAILABLE_REASON,
  PRINTED_SEALED_UNAVAILABLE_REASON,
} from '../../src/routes/play/availability';
import type { AvailabilityFacts } from '../../src/routes/play/availability';
import type { PrintedFormatRow } from '../../src/lab/printed-format';

const SEATED: AvailabilityFacts = { lan: { status: 'ready' } };
const OFFLINE: AvailabilityFacts = { lan: { status: 'unavailable', reason: 'No lab is listening here.' } };
/** The shape of sentence `lanForgeAvailability` hands down when Forge serves other formats. */
const NO_FORGE = 'Forge on this lab does not serve akh-hou over the network; it serves scd.';

const PRINTED: PrintedFormatRow['availability'] = {
  browse: 'available',
  draft: 'unavailable',
  sealed: 'available',
  play: { status: 'supported', reason: 'Verified admission is installed.' },
};

describe('which column the params open', () => {
  it('reads a table token as the network column whatever vs says', () => {
    expect(opponentOf({ table: 'seat-1', vs: 'bot' })).toBe('lan');
    expect(opponentOf({ room: 'seat-2' })).toBe('lan');
  });

  it('reads vs=lan as the network column', () => {
    expect(opponentOf({ vs: 'lan' })).toBe('lan');
  });

  it('opens the bot column by default', () => {
    expect(opponentOf({})).toBe('bot');
    expect(opponentOf({ vs: 'anything-else', table: '' })).toBe('bot');
  });
});

describe('what a kernel set can deal', () => {
  it('deals sealed and constructed against a bot', () => {
    expect(availability('kernel', 'sealed', 'bot', OFFLINE)).toEqual({ status: 'ready' });
    expect(availability('kernel', 'constructed', 'bot', OFFLINE)).toEqual({ status: 'ready' });
    expect(availability('kernel', 'draft', 'bot', OFFLINE)).toEqual({ status: 'ready' });
  });

  it('does not deal Commander in either column', () => {
    expect(availability('kernel', 'commander', 'bot', SEATED)).toEqual({
      status: 'unavailable',
      reason: COMMANDER_UNAVAILABLE_REASON,
    });
    expect(availability('kernel', 'commander', 'lan', SEATED)).toEqual({
      status: 'unavailable',
      reason: COMMANDER_UNAVAILABLE_REASON,
    });
  });

  it('surfaces the network fact the page handed it for the network column', () => {
    expect(availability('kernel', 'constructed', 'lan', OFFLINE)).toEqual(OFFLINE.lan);
    expect(availability('kernel', 'sealed', 'lan', SEATED)).toEqual({ status: 'ready' });
  });
});

describe('what a printed format can deal', () => {
  it('reads draft and sealed off the row', () => {
    expect(availability('printed', 'draft', 'bot', { ...SEATED, printed: PRINTED })).toEqual({
      status: 'unavailable',
      reason: PRINTED_DRAFT_UNAVAILABLE_REASON,
    });
    expect(availability('printed', 'sealed', 'bot', { ...SEATED, printed: PRINTED })).toEqual({
      status: 'ready',
    });
    const noSealed = { ...PRINTED, sealed: 'unavailable' as const };
    expect(availability('printed', 'sealed', 'bot', { ...SEATED, printed: noSealed })).toEqual({
      status: 'unavailable',
      reason: PRINTED_SEALED_UNAVAILABLE_REASON,
    });
  });

  it('reads constructed off the play verdict, reason and all', () => {
    expect(availability('printed', 'constructed', 'bot', { ...SEATED, printed: PRINTED })).toEqual({
      status: 'ready',
    });
    const refused = {
      ...PRINTED,
      play: { status: 'unavailable' as const, reason: 'Forge is not installed.' },
    };
    expect(availability('printed', 'constructed', 'bot', { ...SEATED, printed: refused })).toEqual({
      status: 'unavailable',
      reason: 'Forge is not installed.',
    });
  });

  // `mtg-a982g.5`: which network answer a printed cell gives is the lab's fact
  // rather than the format's, so it reads `facts.lan` the way a kernel set
  // does. The lab hands down what its Forge advertised, and this function says
  // that sentence back whatever it is.
  it('reads the network column off the fact the page handed it', () => {
    const offline = {
      ...OFFLINE,
      lan: { status: 'unavailable' as const, reason: NO_FORGE },
      printed: PRINTED,
    };
    expect(availability('printed', 'sealed', 'lan', offline)).toEqual({
      status: 'unavailable',
      reason: NO_FORGE,
    });
    expect(availability('printed', 'sealed', 'lan', { ...SEATED, printed: PRINTED })).toEqual({
      status: 'ready',
    });
  });

  it('refuses Commander on the play verdict rather than on the format', () => {
    expect(availability('printed', 'commander', 'bot', { ...SEATED, printed: PRINTED })).toEqual({
      status: 'ready',
    });
    const refused = {
      ...PRINTED,
      play: { status: 'unavailable' as const, reason: 'Forge is not installed.' },
    };
    expect(availability('printed', 'commander', 'bot', { ...SEATED, printed: refused })).toEqual({
      status: 'unavailable',
      reason: 'Forge is not installed.',
    });
  });
});

describe('what the Legacy Cube can deal', () => {
  it('drafts against bots and nothing else', () => {
    expect(availability('cube', 'draft', 'bot', SEATED)).toEqual({ status: 'ready' });
    expect(availability('cube', 'sealed', 'bot', SEATED)).toEqual({
      status: 'unavailable',
      reason: CUBE_DRAFT_ONLY_REASON,
    });
    expect(availability('cube', 'commander', 'bot', SEATED)).toEqual({
      status: 'unavailable',
      reason: CUBE_DRAFT_ONLY_REASON,
    });
    // Every format but draft is refused in the cube's own words whichever
    // column asks, and the one it does deal reads the network answer off the
    // page the way a printed format does.
    expect(availability('cube', 'constructed', 'lan', SEATED)).toEqual({
      status: 'unavailable',
      reason: CUBE_DRAFT_ONLY_REASON,
    });
    const offline = { lan: { status: 'unavailable' as const, reason: NO_FORGE } };
    expect(availability('cube', 'draft', 'lan', offline)).toEqual({
      status: 'unavailable',
      reason: NO_FORGE,
    });
    expect(availability('cube', 'draft', 'lan', SEATED)).toEqual({ status: 'ready' });
  });
});
