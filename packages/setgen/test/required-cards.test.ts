import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureProvider } from '@mtg/llm';
import type { GenerationResult, RequiredCardInput, SetBrief, SetBriefInput } from '@mtg/setgen';
import { allocateSlots, buildFillPrompt, generateSet, parseBrief } from '@mtg/setgen';
import { scriptedTransport, TEST_BRIEF } from './helpers';

/**
 * Required cards: a brief names cards the set must contain.
 *
 * The split under test is the ZFC one. Code decides whether the finished set
 * contains a card with the stated name, and reserves a slot for it before any
 * call; the model decides what that card is. Nothing here maps a name to a
 * color, a cost or a type.
 *
 * The byte-level pin for "a brief requiring nothing behaves as it did" is
 * `recorded-set.test.ts`, which replays the committed Tideglass Reach fixtures:
 * those keys are hashes of the fill prompt, so a stray byte in a prompt built
 * from a brief with no required cards fails that file, not this one.
 */

function withRequired(requiredCards: readonly RequiredCardInput[]): SetBriefInput {
  return { ...TEST_BRIEF, requiredCards: [...requiredCards] };
}

const MOONBLADE: RequiredCardInput = {
  name: 'Moonblade',
  flavorDirection: 'The sword that seals the darkness; the centerpiece of the set.',
};
const SILVER_DIREHORN: RequiredCardInput = {
  name: 'Silver Direhorn',
  color: 'R',
  cardKind: 'creature',
};

describe('the brief boundary', () => {
  it('defaults to no required cards', () => {
    expect(parseBrief(TEST_BRIEF).requiredCards).toStrictEqual([]);
  });

  it('rejects two required cards with the same name', () => {
    expect(() => parseBrief(withRequired([{ name: 'Moonblade' }, { name: 'moonblade' }]))).toThrow(
      /Moonblade/,
    );
  });

  it('rejects a blank required name', () => {
    expect(() => parseBrief(withRequired([{ name: '   ' }]))).toThrow(/blank/);
    expect(() => parseBrief(withRequired([{ name: '' }]))).toThrow();
  });

  it('rejects a required name longer than a printed card name may be', () => {
    expect(() => parseBrief(withRequired([{ name: 'x'.repeat(41) }]))).toThrow();
  });

  it('rejects more required cards than the set has cards', () => {
    const many = Array.from({ length: 21 }, (_unused, index) => ({
      name: `Required Card ${index + 1}`,
    }));
    expect(() => parseBrief(withRequired(many))).toThrow(/21 named cards.*20-card set/);
  });
});

describe('allocation', () => {
  it('reserves exactly one slot per required card, honoring a stated color and kind', () => {
    const brief = parseBrief(withRequired([MOONBLADE, SILVER_DIREHORN]));
    const { slots } = allocateSlots(brief);

    const reserved = slots.filter((slot) => slot.requiredCard !== undefined);
    expect(reserved).toHaveLength(2);
    expect(reserved.map((slot) => slot.requiredCard?.name).sort()).toStrictEqual([
      'Moonblade',
      'Silver Direhorn',
    ]);

    const direhorn = slots.find((slot) => slot.requiredCard?.name === 'Silver Direhorn');
    expect(direhorn?.color).toBe('R');
    expect(direhorn?.cardKind).toBe('creature');
  });

  it('reserves the same slots on every run of the same seed', () => {
    const brief = parseBrief(withRequired([MOONBLADE, SILVER_DIREHORN]));
    const first = allocateSlots(brief).slots.map((slot) => `${slot.id}:${slot.requiredCard?.name ?? ''}`);
    const second = allocateSlots(brief).slots.map((slot) => `${slot.id}:${slot.requiredCard?.name ?? ''}`);
    expect(second).toStrictEqual(first);
  });

  it('records each reservation as an allocation note', () => {
    const { notes } = allocateSlots(parseBrief(withRequired([MOONBLADE])));
    expect(notes.some((note) => note.includes('Moonblade'))).toBe(true);
  });

  it('leaves a brief that requires nothing untouched', () => {
    const { slots } = allocateSlots(parseBrief(TEST_BRIEF));
    expect(JSON.stringify(slots)).not.toContain('requiredCard');
  });
});

describe('allocation refuses what it cannot place', () => {
  it('names the card when a color is asked for more cards than it has slots', () => {
    const white = allocateSlots(parseBrief(TEST_BRIEF)).slots.filter((slot) => slot.color === 'W').length;
    expect(white).toBeGreaterThan(0);
    const required = Array.from({ length: white + 1 }, (_unused, index) => ({
      name: `White Card ${index + 1}`,
      color: 'W' as const,
    }));
    const brief = parseBrief(withRequired(required));

    expect(() => allocateSlots(brief)).toThrow(/White Card/);
    expect(() => allocateSlots(brief)).toThrow(new RegExp(`all ${white} matching slots`));
  });

  it('names the card when no slot in the set can take it at all', () => {
    const brief = parseBrief(withRequired([{ name: 'Impossible Relic', color: 'W', cardKind: 'artifact' }]));
    expect(() => allocateSlots(brief)).toThrow(/Impossible Relic/);
    expect(() => allocateSlots(brief)).toThrow(/no slot in the set matches/);
  });
});

describe('the fill prompt', () => {
  const brief = parseBrief(withRequired([MOONBLADE]));
  const allocation = allocateSlots(brief);
  const reserved = allocation.slots.find((slot) => slot.requiredCard !== undefined);

  function promptFor(slotIds: readonly string[]): string {
    return buildFillPrompt({
      brief,
      slots: allocation.slots.filter((slot) => slotIds.includes(slot.id)),
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
  }

  it('states the required name and its flavor direction on the reserved slot', () => {
    const prompt = promptFor([reserved?.id ?? '']);
    expect(prompt).toContain('exactly "Moonblade"');
    expect(prompt).toContain('seals the darkness');
  });

  it('says nothing about required cards on any other slot', () => {
    const others = allocation.slots.filter((slot) => slot.id !== reserved?.id).map((slot) => slot.id);
    expect(promptFor(others)).not.toContain('Moonblade');
  });
});

describe('generateSet', () => {
  async function run(
    brief: SetBrief,
    options: { readonly ignoreRequiredNames?: boolean },
  ): Promise<GenerationResult> {
    const allocation = allocateSlots(brief);
    const provider = createFixtureProvider({
      dir: mkdtempSync(join(tmpdir(), 'setgen-required-')),
      record: true,
      delegate: scriptedTransport({ slots: allocation.slots, ...options }),
    });
    return generateSet({ provider, brief, critique: false, maxRetryRounds: 0 });
  }

  it('prints every required card, by name, exactly once', async () => {
    const result = await run(parseBrief(withRequired([MOONBLADE, SILVER_DIREHORN])), {});

    const names = result.cards.map((card) => card.name);
    expect(names.filter((name) => name === 'Moonblade')).toHaveLength(1);
    expect(names.filter((name) => name === 'Silver Direhorn')).toHaveLength(1);
    expect(result.report.cardsPrinted).toBe(20);
    expect(result.report.findings.filter((item) => item.severity === 'error')).toStrictEqual([]);
    expect(result.report.enforceable).toBe(true);
  });

  it('fails with the card name in the message when the required card never arrives', async () => {
    const result = await run(parseBrief(withRequired([MOONBLADE, SILVER_DIREHORN])), {
      ignoreRequiredNames: true,
    });

    const missing = result.report.findings.filter((item) => item.code === 'REQUIRED_CARD_MISSING');
    expect(missing).toHaveLength(2);
    expect(missing.map((item) => item.message).join('\n')).toContain('Moonblade');
    expect(missing.every((item) => item.severity === 'error')).toBe(true);
    // The finding blames the reserved slot, so the retry loop regenerates it.
    expect(missing.every((item) => item.slotIds.length === 1)).toBe(true);
    expect(result.report.enforceable).toBe(false);
  });

  it('prints the same 20 cards it always did when the brief requires nothing', async () => {
    const result = await run(parseBrief(TEST_BRIEF), {});
    expect(result.report.cardsPrinted).toBe(20);
    expect(result.report.findings.filter((item) => item.code === 'REQUIRED_CARD_MISSING')).toStrictEqual([]);
    expect(result.report.enforceable).toBe(true);
  });
});
