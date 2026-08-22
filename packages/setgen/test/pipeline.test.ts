import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModelEffect } from '@mtg/dsl';
import { hasViolation, mana } from '@mtg/dsl';
import { createFixtureProvider } from '@mtg/llm';
import type { CritiqueRevision, FilledCard, GenerationResult, SetBrief, Slot } from '@mtg/setgen';
import {
  allocateSlots,
  assembleCard,
  formatReport,
  generateSet,
  parseBrief,
  parseSetFile,
  writeSetOutput,
} from '@mtg/setgen';
import { scriptedTransport, TEST_BRIEF } from './helpers';

/**
 * The hermetic end-to-end run.
 *
 * Pass one records: the real fixture provider in record mode, with a scripted
 * backend standing in for the model, writes a fixture per request. Pass two
 * replays those files with no backend at all. Nothing here touches the network
 * or spends anything, and the replay proves the recorded run is reproducible -
 * which is the property CI depends on.
 */

const RETRY_SLOT = 'CW01';
const APPLIED_SLOT = 'CU01';
const REVERTED_SLOT = 'CB01';

const revisions: CritiqueRevision[] = [
  {
    slotId: APPLIED_SLOT,
    category: 'flavor',
    severity: 'major',
    observation: 'The name repeats the same noun as three other blue cards.',
    instruction: 'Rename it around tide and glass without reusing "Warden".',
  },
  {
    slotId: REVERTED_SLOT,
    category: 'powerLevel',
    severity: 'major',
    observation: 'This body outclasses everything else at its cost.',
    instruction: 'Shrink the creature or raise its cost.',
  },
  {
    slotId: APPLIED_SLOT,
    category: 'cohesion',
    severity: 'minor',
    observation: 'A minor note that should never spend a regeneration.',
    instruction: 'Consider a different creature type.',
  },
];

let brief: SetBrief;
let fixtureDir: string;
let recorded: GenerationResult;

beforeAll(async () => {
  brief = parseBrief(TEST_BRIEF);
  fixtureDir = mkdtempSync(join(tmpdir(), 'setgen-fixtures-'));
  const allocation = allocateSlots(brief);
  const provider = createFixtureProvider({
    dir: fixtureDir,
    record: true,
    delegate: scriptedTransport({
      slots: allocation.slots,
      failFirstFor: [RETRY_SLOT],
      breakRevisionFor: [REVERTED_SLOT],
      revisions,
    }),
  });
  recorded = await generateSet({ provider, brief });
});

describe('generateSet, recording pass', () => {
  it('prints every slot and every card is legal DSL', () => {
    expect(recorded.report.slots).toBe(20);
    expect(recorded.report.cardsPrinted).toBe(20);
    expect(recorded.report.legalCards).toBe(20);
    expect(recorded.cards).toHaveLength(20);
  });

  it('converges: the set is enforceable with no outstanding errors', () => {
    const errors = recorded.report.findings.filter((item) => item.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).toStrictEqual([]);
    expect(recorded.report.enforceable).toBe(true);
  });

  it('retries only the offending slot, and repairs it', () => {
    expect(recorded.report.attemptsPerSlot[RETRY_SLOT]).toBe(2);
    expect(recorded.report.slotsNeedingRetry).toContain(RETRY_SLOT);
    expect(recorded.report.retryRounds).toHaveLength(1);
    const round = recorded.report.retryRounds[0];
    expect(round?.slotIds).toStrictEqual([RETRY_SLOT]);
    expect(round?.causes).toContain('SLOT_MANA_VALUE_MISS');
    expect(round?.slotsRepaired).toBe(1);
  });

  it('leaves every other slot on a single attempt', () => {
    const retried = Object.entries(recorded.report.attemptsPerSlot).filter(([, count]) => count > 1);
    const expected = [RETRY_SLOT, APPLIED_SLOT, REVERTED_SLOT].sort();
    expect(retried.map(([slotId]) => slotId).sort()).toStrictEqual(expected);
  });

  it('applies a good critique revision and reverts one that breaks the card', () => {
    expect(recorded.report.critique.ran).toBe(true);
    expect(recorded.report.critique.critique?.archetypeSupport).toContain('GW');

    const applied = recorded.report.critique.revisions.find((item) => item.slotId === APPLIED_SLOT);
    expect(applied?.outcome).toBe('applied');
    const reverted = recorded.report.critique.revisions.find((item) => item.slotId === REVERTED_SLOT);
    expect(reverted?.outcome).toBe('reverted');
    expect(reverted?.reason).toContain('SLOT_MANA_VALUE_MISS');

    // Minor notes are recorded but never regenerate a card.
    expect(recorded.report.critique.revisions).toHaveLength(2);
  });

  it('keeps the applied revision and restores the reverted card', () => {
    const byId = new Map(recorded.cards.map((card) => [card.set.collectorNumber, card]));
    const applied = recorded.allocation.slots.find((slot) => slot.id === APPLIED_SLOT);
    const reverted = recorded.allocation.slots.find((slot) => slot.id === REVERTED_SLOT);
    expect(byId.get(applied?.collectorNumber ?? -1)?.name).toContain('Revised');
    expect(byId.get(reverted?.collectorNumber ?? -1)?.name).not.toContain('Revised');
  });

  it('accounts for every call it made', () => {
    expect(recorded.report.usage.calls).toBeGreaterThan(10);
    expect(recorded.report.usage.failedCalls).toBe(0);
    expect(recorded.report.usage.costUsd).toBeGreaterThan(0);
    expect(recorded.report.usage.costSource).toBe('estimated');
    expect(recorded.report.usage.usage.outputTokens).toBeGreaterThan(0);
  });

  it('reports that it corrected nothing when there was nothing to correct', () => {
    expect(recorded.report.duplicateEffectsDropped).toBe(0);
    expect(formatReport(recorded.report)).not.toContain('repeated effect');
  });

  it('reports the allocation judgments and DSL v0 substitutions it relied on', () => {
    expect(recorded.report.notes.some((note) => note.includes('Glasscut'))).toBe(true);
    expect(recorded.report.notes.some((note) => note.startsWith('counterspell:'))).toBe(false);
    expect(recorded.report.notes.some((note) => note.includes('DSL v0'))).toBe(true);
  });
});

describe('generateSet, replay pass', () => {
  it('reproduces the recorded set exactly from fixtures alone', async () => {
    const replay = createFixtureProvider({ dir: fixtureDir, record: false });
    const result = await generateSet({ provider: replay, brief });

    expect(JSON.stringify(result.cards)).toBe(JSON.stringify(recorded.cards));
    expect(result.report.attemptsPerSlot).toStrictEqual(recorded.report.attemptsPerSlot);
    expect(result.report.enforceable).toBe(true);
    expect(result.report.critique.revisions.map((item) => item.outcome)).toStrictEqual(
      recorded.report.critique.revisions.map((item) => item.outcome),
    );
  });

  /**
   * The unseen prompt is made by moving the theme, not the seed.
   *
   * A different seed used to be the cheapest way to get a prompt this directory
   * has never stored, and at every size but one it still is. At twenty cards it
   * is not: two commons and one uncommon a color is exactly the number of cards
   * the allocator has choices to place, so its rng never picks between two
   * outcomes and the slots come out byte-identical whatever the seed says
   * (`allocate.test.ts` asserts that floor directly). This test would then
   * replay the recorded run and pass nothing. The theme is prose the prompt
   * quotes, so moving it moves every request in the run.
   */
  it('refuses to invent a response for a prompt it has never seen', async () => {
    const replay = createFixtureProvider({ dir: fixtureDir, record: false });
    const unseen = parseBrief({ ...TEST_BRIEF, theme: 'A proving ground of ash flats and dead kilns.' });
    await expect(generateSet({ provider: replay, brief: unseen })).rejects.toThrow(/no fixture for key/);
  });
});

describe('assembleCard, effect normalization', () => {
  const removalSlot: Slot = {
    id: 'CB05',
    index: 4,
    collectorNumber: 5,
    rarity: 'common',
    color: 'B',
    cardKind: 'instant',
    role: 'removalSmall',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: ['destroyPermanent'],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };

  function filled(effects: readonly ModelEffect[]): FilledCard {
    return {
      slotId: removalSlot.id,
      kind: 'instant',
      name: 'Reef Verdict',
      manaCost: mana({ generic: 1, B: 1 }),
      effects: [...effects],
      designNote: 'Plain removal, used to exercise assembly.',
    };
  }

  const destroy: ModelEffect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };

  it('drops a repeated effect, prints one sentence, and counts what it dropped', () => {
    const assembly = assembleCard(removalSlot, filled([destroy, destroy]), 'TST');
    expect(assembly.violations).toStrictEqual([]);
    expect(assembly.card?.effects).toStrictEqual([destroy]);
    expect(assembly.card?.oracleText).toBe('Destroy target creature.');
    expect(assembly.duplicateEffectsDropped).toBe(1);
  });

  it('keeps two effects that genuinely differ, and drops nothing', () => {
    const damage: ModelEffect = { kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } };
    const assembly = assembleCard(removalSlot, filled([destroy, damage]), 'TST');
    expect(assembly.card?.effects).toStrictEqual([destroy, damage]);
    expect(assembly.duplicateEffectsDropped).toBe(0);
  });

  it('counts the drop even when the card is then rejected', () => {
    // The repeat happened whatever became of the card; a count that only
    // survived the happy path would understate how often the model proposes one.
    //
    // A destroy aimed at a player is still rejected, and since the sweeper was
    // added it is rejected as an incomplete sentence rather than as an illegal
    // target: the player slot is legal on the row now, and what makes it a card
    // is the `scope` beside it. A model cannot write that scope — it is not on
    // `ModelEffectSchema` — so this shape stays unconditionally dead on the
    // generated path, which is what this fixture needs it to be.
    const offTarget: ModelEffect = { kind: 'destroyPermanent', target: { kind: 'targetPlayer' } };
    const assembly = assembleCard(removalSlot, filled([offTarget, offTarget]), 'TST');
    expect(assembly.card).toBeUndefined();
    expect(hasViolation(assembly.violations, 'ILLEGAL_EFFECT_SCOPE')).toBe(true);
    expect(assembly.duplicateEffectsDropped).toBe(1);
  });
});

describe('emitted files', () => {
  it('writes a set file that parses back through its own schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setgen-out-'));
    const paths = writeSetOutput(dir, recorded);
    const parsed = parseSetFile(JSON.parse(readFileSync(paths.setPath, 'utf8')) as unknown);
    expect(parsed.set.code).toBe('TST');
    expect(parsed.cards).toHaveLength(20);
    expect(parsed.cards.map((card) => card.set.collectorNumber)).toStrictEqual(
      recorded.cards.map((card) => card.set.collectorNumber),
    );

    const report = JSON.parse(readFileSync(paths.reportPath, 'utf8')) as { enforceable: boolean };
    expect(report.enforceable).toBe(true);

    // No timestamps, no machine paths: the same run writes the same bytes.
    const again = writeSetOutput(dir, recorded);
    expect(readFileSync(again.setPath, 'utf8')).toBe(readFileSync(paths.setPath, 'utf8'));
  });
});
