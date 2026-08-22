/**
 * Asking a brief for a particular trigger condition.
 *
 * `mtg-itf` measured a generated set's triggered half and found it was thirteen
 * death triggers, one attack trigger and no enters trigger at all, on two
 * separate builds. The cause was not the vocabulary: `selfEnters` is the first
 * member of `TRIGGER_CONDITIONS`, `ModelAbilitySchema` admits it through
 * `TriggerConditionSchema` unnarrowed, the kernel raises it off
 * `permanentEntered`, and the fill prompt's `<ability_vocabulary>` has always
 * enumerated all three conditions by name. One of the two recorded runs proves
 * the model reaches for it: two of its cards printed an enters trigger, both on
 * signpost slots that named no mechanic.
 *
 * The cause was that nothing could *ask*. A slot's ability kinds come from a
 * brief mechanic, both of that brief's mechanics describe a permanent dying,
 * and the prompt names the mechanic on the slot line - so fifteen of the
 * twenty-one triggered slots were told to print a mechanic about dying, and the
 * rest followed the set's flavor. Trigger conditions were the one design axis
 * the brief could hint at in prose and not state.
 *
 * These are the four hops that close it - stated, reserved, printed, read back -
 * plus the end-to-end run showing the same brief printing a different condition
 * with the field and without it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProvider } from '@mtg/llm';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { GenerationResult, SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import {
  allocateSlots,
  buildFillPrompt,
  censusTriggerConditions,
  checkSlotConformance,
  formatReport,
  generateSet,
  parseBrief,
} from '@mtg/setgen';
import { scriptedTransport } from './helpers';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A brief whose one ability mechanic states the condition it wants.
 *
 * White, because `gainLife` is white's own and the scripted transport answers
 * an ability slot with it: a mechanic asking for a trigger in a color that
 * cannot print the effect fails the pie check instead of this one.
 */
function wardenBrief(conditions?: readonly ['selfEnters']): SetBriefInput {
  return {
    setCode: 'TRG',
    setName: 'Trigger Proving Ground',
    theme: 'A watchpost set, used to exercise which condition a printed trigger watches for.',
    seed: 'trigger-seed-1',
    targetSize: 20,
    mechanics: [
      {
        name: 'Watchpost',
        description: 'A warden pays out when it takes up its post.',
        abilityKinds: ['triggered'],
        effectKinds: ['gainLife'],
        ...(conditions === undefined ? {} : { triggerConditions: [...conditions] }),
        colors: ['W'],
      },
    ],
    archetypeNotes: [],
  };
}

const STATED = parseBrief(wardenBrief(['selfEnters']));
const UNSTATED = parseBrief(wardenBrief());

function promptFor(brief: SetBrief, slots: readonly Slot[]): string {
  const allocation = allocateSlots(brief);
  return buildFillPrompt({
    brief,
    slots,
    rarityRules: allocation.profile.rarityRules,
    archetypes: allocation.archetypes,
    priorNames: [],
    sameColorCards: [],
    tierCards: [],
    corrections: new Map(),
    revisions: new Map(),
  });
}

function reservedSlots(brief: SetBrief): readonly Slot[] {
  return allocateSlots(brief).slots.filter((slot) => slot.mechanics.includes('Watchpost'));
}

async function runFor(brief: SetBrief): Promise<GenerationResult> {
  const allocation = allocateSlots(brief);
  const provider = createProvider(scriptedTransport({ slots: allocation.slots }));
  return generateSet({ provider, brief });
}

describe('a brief stating which condition its mechanic triggers on', () => {
  it('is refused when the mechanic prints no trigger to hang the condition on', () => {
    const brief = wardenBrief(['selfEnters']);
    const mechanic = brief.mechanics[0];
    if (mechanic === undefined) throw new Error('the warden brief lost its mechanic');
    expect(() => parseBrief({ ...brief, mechanics: [{ ...mechanic, abilityKinds: ['activated'] }] })).toThrow(
      /naming trigger conditions must also name/,
    );
  });

  /**
   * The briefs are read off the directory rather than listed, so a brief added
   * later is checked too. That matters more than tidiness here: this is the
   * assertion behind "every recorded fixture still replays", and a list would
   * stop covering the run somebody records next.
   */
  it('defaults to empty, which is every brief committed in this tree', () => {
    const briefDir = join(PACKAGE_ROOT, 'briefs');
    const files = readdirSync(briefDir).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const brief = parseBrief(JSON.parse(readFileSync(join(briefDir, name), 'utf8')) as unknown);
      for (const mechanic of brief.mechanics) {
        expect(mechanic.triggerConditions, `${name}: ${mechanic.name}`).toStrictEqual([]);
      }
    }
  });
});

describe('the allocator, handed a mechanic that states its condition', () => {
  it('carries the condition onto every slot it reserves for that mechanic', () => {
    const reserved = reservedSlots(STATED);
    expect(reserved.length).toBeGreaterThan(0);
    for (const slot of reserved) expect(slot.triggerConditions).toStrictEqual(['selfEnters']);
  });

  it('leaves the condition empty on every slot the mechanic did not claim', () => {
    const allocation = allocateSlots(STATED);
    const others = allocation.slots.filter((slot) => !slot.mechanics.includes('Watchpost'));
    for (const slot of others) expect(slot.triggerConditions).toStrictEqual([]);
  });

  it('leaves it empty everywhere when the brief states nothing', () => {
    for (const slot of allocateSlots(UNSTATED).slots) expect(slot.triggerConditions).toStrictEqual([]);
  });

  it('says in its notes which condition the slot was reserved on', () => {
    const notes = allocateSlots(STATED).notes.filter((note) => note.includes('prints mechanic'));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note).toContain('on selfEnters');
  });
});

describe('the fill prompt for a slot whose condition was stated', () => {
  it('tells the model the condition on the slot line', () => {
    const slots = reservedSlots(STATED);
    const prompt = promptFor(STATED, slots);
    expect(prompt).toContain('trigger condition: selfEnters');
  });

  /**
   * The bytes are the fixture key, so this is not a style claim: a slot line
   * that grew a sentence for briefs stating nothing would strand every recorded
   * run in `fixtures/llm/` and `fixtures/llm-hearthglass/`, and getting them
   * back is a live generation. The recorded replays are the other half of this
   * check and they run in the same suite.
   */
  it('says nothing at all when the brief stated nothing', () => {
    const prompt = promptFor(UNSTATED, reservedSlots(UNSTATED));
    expect(prompt).not.toContain('trigger condition');
  });

  it('still enumerates all three conditions for the batch, because the schema takes all three', () => {
    const prompt = promptFor(STATED, reservedSlots(STATED));
    expect(prompt).toContain('condition (selfEnters | selfAttacks | selfDies)');
  });
});

describe('reading the printed card back against the condition its slot stated', () => {
  const slot = (conditions: readonly ('selfEnters' | 'selfDies')[]): Slot => ({
    id: 'CW01',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'W',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: ['triggered'],
    auraModifications: [],
    triggerConditions: conditions,
    mechanics: ['Watchpost'],
    archetypes: [],
    signpost: false,
  });

  const warden = (condition: 'selfEnters' | 'selfDies'): Card =>
    parseCard({
      id: 'trg-warden',
      name: 'Watchpost Warden',
      kind: 'creature',
      colors: ['W'],
      manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
      rarity: 'common',
      set: { code: 'TRG', collectorNumber: 1 },
      subtypes: ['Human', 'Soldier'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition,
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });

  it('accepts the condition the slot asked for', () => {
    expect(checkSlotConformance(slot(['selfEnters']), warden('selfEnters'))).toStrictEqual([]);
  });

  it('refuses another condition as an error the regeneration loop can act on', () => {
    const findings = checkSlotConformance(slot(['selfEnters']), warden('selfDies'));
    const mismatch = findings.filter((item) => item.code === 'SLOT_TRIGGER_MISMATCH');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.severity).toBe('error');
    expect(mismatch[0]?.slotIds).toStrictEqual(['CW01']);
    expect(mismatch[0]?.message).toContain('selfDies');
  });

  it('says nothing about a condition on a slot that stated none', () => {
    expect(checkSlotConformance(slot([]), warden('selfDies'))).toStrictEqual([]);
    expect(checkSlotConformance(slot([]), warden('selfEnters'))).toStrictEqual([]);
  });
});

/**
 * The end-to-end claim, hermetic and free.
 *
 * The backend is `scriptedTransport`, so what this proves is the plumbing —
 * stated, reserved, printed on the slot line, carried onto the card, counted in
 * the report — and not what a live model does when it is told. That second
 * question needs a paid run and is deliberately not asked here. What makes the
 * pair worth running is that the two briefs differ in one field and the sets
 * differ in which condition every trigger watches for.
 */
describe('a generated set whose brief asked for an enters trigger', () => {
  it('prints enters triggers and no others', async () => {
    const result = await runFor(STATED);
    const census = censusTriggerConditions(result.cards);
    expect(census.selfEnters).toBeGreaterThan(0);
    expect(census.selfDies).toBe(0);
    expect(result.report.findings.filter((item) => item.severity === 'error')).toStrictEqual([]);
    expect(result.report.enforceable).toBe(true);
  });

  it('prints death triggers instead when the same brief states nothing', async () => {
    const result = await runFor(UNSTATED);
    const census = censusTriggerConditions(result.cards);
    expect(census.selfEnters).toBe(0);
    expect(census.selfDies).toBeGreaterThan(0);
  });

  it('reports the spread, all three conditions, so a zero is visible', async () => {
    const result = await runFor(STATED);
    expect(result.report.triggerConditions).toStrictEqual(censusTriggerConditions(result.cards));
    expect(formatReport(result.report)).toMatch(
      /triggers: \d+ on selfEnters \d+, selfAttacks \d+, selfDies \d+/,
    );
  });
});
