import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureProvider } from '@mtg/llm';
import type { CritiqueRecord, CritiqueRevision, GenerationReport } from '@mtg/setgen';
import { allocateSlots, formatReport, generateSet, parseBrief } from '@mtg/setgen';
import { scriptedTransport, TEST_BRIEF } from './helpers';

/**
 * What the report says about the one pass that makes a judgment.
 *
 * the flagship set's `report.json` recorded a reviewer that opened "the set
 * does not yet read as the set the brief describes", and in the same file
 * `enforceable: true` and `findings: []`. Nothing read the critique: the
 * enforceable flag counts parses, slots and legality, and one of that run's nine
 * major revisions was reverted with no trace anywhere a reader looks
 * (`mtg-rz5h`).
 *
 * The fix splits authority rather than merging it. The reviewer's per-slot asks
 * are structured and severity-labeled by the reviewer itself, so an ask the set
 * does not carry lands in `findings` as a warning. The reviewer's prose is
 * judgment with no gate behind it, so it is printed in full and labeled
 * unenforced. `enforceable` keeps its own meaning and stops being read as the
 * whole verdict.
 */

const REVERTED_SLOT = 'CB01';
const APPLIED_SLOT = 'CU01';
const ABSENT_SLOT = 'CZ99';

const revisions: readonly CritiqueRevision[] = [
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
    slotId: ABSENT_SLOT,
    category: 'cohesion',
    severity: 'major',
    observation: 'The set mints a currency it never lets anyone spend.',
    instruction: 'Print a card that spends a Key.',
  },
  {
    slotId: APPLIED_SLOT,
    category: 'cohesion',
    severity: 'minor',
    observation: 'A minor note that should never spend a regeneration.',
    instruction: 'Consider a different creature type.',
  },
];

async function runWithCritique(): Promise<GenerationReport> {
  const brief = parseBrief(TEST_BRIEF);
  const allocation = allocateSlots(brief);
  const provider = createFixtureProvider({
    dir: mkdtempSync(join(tmpdir(), 'setgen-critique-standing-')),
    record: true,
    delegate: scriptedTransport({
      slots: allocation.slots,
      breakRevisionFor: [REVERTED_SLOT],
      revisions,
    }),
  });
  const result = await generateSet({ provider, brief, flavor: false });
  return result.report;
}

function unresolved(report: GenerationReport) {
  return report.findings.filter((item) => item.code === 'CRITIQUE_UNRESOLVED');
}

describe('a critique ask the set does not carry lands in the findings', () => {
  it('reports the reverted revision and the one that named a slot the set never printed', async () => {
    const report = await runWithCritique();

    const codes = unresolved(report).map((item) => item.slotIds.join(','));
    expect(codes.sort()).toStrictEqual([REVERTED_SLOT, ABSENT_SLOT].sort());
    for (const item of unresolved(report)) expect(item.severity).toBe('warning');

    const reverted = unresolved(report).find((item) => item.slotIds.includes(REVERTED_SLOT));
    expect(reverted?.message).toContain('reverted');
    expect(reverted?.message).toContain('Shrink the creature');

    const absent = unresolved(report).find((item) => item.slotIds.includes(ABSENT_SLOT));
    expect(absent?.message).toContain('dropped');
    expect(absent?.message).toContain('which this set did not print');
  });

  it('says nothing about the revision the set does carry, and nothing about a minor note', async () => {
    const report = await runWithCritique();

    expect(unresolved(report).some((item) => item.slotIds.includes(APPLIED_SLOT))).toBe(false);
    const applied = report.critique.revisions.filter((item) => item.outcome === 'applied');
    expect(applied.map((item) => item.slotId)).toStrictEqual([APPLIED_SLOT]);
    // Four revisions, three of them major: the minor one never becomes a record.
    expect(report.critique.revisions).toHaveLength(3);
  });

  it('records the dropped ask with its reason instead of discarding it', async () => {
    const report = await runWithCritique();

    const dropped = report.critique.revisions.find((item) => item.slotId === ABSENT_SLOT);
    expect(dropped?.outcome).toBe('dropped');
    expect(dropped?.reason).toContain(ABSENT_SLOT);
    expect(dropped?.instruction).toBe('Print a card that spends a Key.');
  });

  it('annotates the run rather than failing it: every deterministic gate still passed', async () => {
    const report = await runWithCritique();

    expect(report.enforceable).toBe(true);
    expect(report.findings.filter((item) => item.severity === 'error')).toStrictEqual([]);
    expect(unresolved(report).length).toBeGreaterThan(0);
  });
});

function reportWithCritique(critique: CritiqueRecord): GenerationReport {
  return {
    setCode: 'XMP',
    setName: 'the flagship set',
    seed: 'seed-1',
    targetSize: 249,
    profile: { name: 'test-profile', version: 1, derivedFrom: 'fixture' },
    slots: 249,
    cardsPrinted: 249,
    authoredCards: 0,
    legalCards: 249,
    attemptsPerSlot: {},
    slotsNeedingRetry: [],
    duplicateEffectsDropped: 0,
    triggerConditions: {
      selfEnters: 0,
      selfAttacks: 0,
      selfDies: 0,
      selfDiesNotSacrificed: 0,
      controlledCreatureAttacksAlone: 0,
      selfDealsCombatDamageToCreature: 0,
      beginningOfYourUpkeep: 0,
      beginningOfYourEndStep: 0,
      anotherControlledPermanentEnters: 0,
      anotherControlledCreatureEnters: 0,
      youCastSpell: 0,
      youCastInstantOrSorcery: 0,
      selfDealsCombatDamageToPlayer: 0,
      selfBlocks: 0,
      selfBlocksOrIsBlockedByGreaterPower: 0,
      youGainLife: 0,
      selfEntersOrAttacks: 0,
      aPlayerCastsWhiteSpell: 0,
      aPlayerCastsBlueSpell: 0,
      aPlayerCastsBlackSpell: 0,
      aPlayerCastsRedSpell: 0,
      aPlayerCastsGreenSpell: 0,
      opponentDealtNoncombatDamage: 0,
      anotherControlledCreatureWithPowerThreeOrGreaterEnters: 0,
      beginningOfEndStep: 0,
    },
    retryRounds: [],
    critique,
    archetypes: [],
    findings: [],
    enforceable: true,
    usage: {
      calls: 1,
      failedCalls: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      costUsd: 0,
      costSource: 'reported',
      durationMs: 1,
    },
    notes: [],
  };
}

const VERDICT = 'The set does not yet read as the set the brief describes.';

describe('the printed report states the critique as an opinion nothing enforces', () => {
  it('prints the reviewer prose that used to reach the JSON and no reader', () => {
    const output = formatReport(
      reportWithCritique({
        ran: true,
        revisions: [],
        critique: {
          cohesion: VERDICT,
          archetypeSupport: 'WG (fuse everything onto one creature): starved.',
          flavorConsistency: 'Names stay inside the stated world.',
          powerOutliers: 'Nothing is outside the Limited power band.',
          revisions: [],
        },
      }),
    );

    expect(output).toContain(VERDICT);
    expect(output).toContain('WG (fuse everything onto one creature): starved.');
    expect(output).toMatch(/critique verdict.*nothing here fails the run/);
  });

  it('scopes the enforceable line to the gates it actually covers', () => {
    const output = formatReport(reportWithCritique({ ran: false, revisions: [] }));
    const line = output.split('\n').find((item) => item.startsWith('enforceable:'));

    expect(line).toBe('enforceable: yes (deterministic gates only; the design critique is not one of them)');
    expect(output).toContain('critique: skipped');
  });

  it('counts the asks the set does not carry beside the ones it does', () => {
    const output = formatReport(
      reportWithCritique({
        ran: true,
        critique: {
          cohesion: VERDICT,
          archetypeSupport: 'starved',
          flavorConsistency: 'fine',
          powerOutliers: 'fine',
          revisions: [],
        },
        revisions: [
          { slotId: 'CU01', category: 'flavor', observation: 'o', instruction: 'i', outcome: 'applied' },
          {
            slotId: 'CB01',
            category: 'powerLevel',
            observation: 'o',
            instruction: 'i',
            outcome: 'reverted',
            reason: 'SLOT_MANA_VALUE_MISS',
          },
        ],
      }),
    );

    expect(output).toContain('critique: 1/2 major revision(s) applied, 1 unresolved');
  });
});
