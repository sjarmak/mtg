import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '@mtg/llm';
import { formatReport, type GenerationReport } from '../src/report';

function baseReport(): GenerationReport {
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
    critique: { ran: false, revisions: [] },
    archetypes: [],
    findings: [],
    enforceable: true,
    usage: {
      calls: 56,
      failedCalls: 0,
      usage: {
        ...ZERO_USAGE,
        inputTokens: 68,
        outputTokens: 169574,
        cacheCreationInputTokens: 1847881,
        cacheReadInputTokens: 798248,
      },
      costUsd: 46.2352,
      costSource: 'reported',
      durationMs: 1000,
    },
    notes: [],
  };
}

describe('formatReport', () => {
  it('names all four billed token components, not just fresh input and output', () => {
    const output = formatReport(baseReport());
    const tokenLine = output.split('\n').find((line) => line.startsWith('calls:'));
    expect(tokenLine).toBeDefined();
    // The old two-field format collapsed a cached run to "68 in / 169574 out",
    // hiding 1,847,881 cache-creation and 798,248 cache-read tokens.
    expect(tokenLine).toContain('cache write');
    expect(tokenLine).toContain('cache read');
    expect(tokenLine).toContain('fresh input');
    expect(tokenLine).toContain('output');
    expect(tokenLine).not.toMatch(/68 in \/ 169574 out/);
  });
});
