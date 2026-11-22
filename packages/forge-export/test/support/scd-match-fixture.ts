/**
 * Starter Commander Decks whole-game probe fixture: one basic, one audited
 * one-drop, and the one audited SCD legendary creature as both seats' general.
 *
 * Trostani Discordant rather than a precon's own face commander because the
 * whole-match launcher admits the audited Forge slice only, and none of the
 * five SCD face commanders is in it; every other card here is audited too.
 */
import { COMMANDER_RULES } from '@mtg/engine';
import type { PrintedMatchFixture } from './printed-match-probes';

export const SCD_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'scd',
  title: 'SCD',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  rules: COMMANDER_RULES,
  commanders: [['Trostani Discordant'], ['Trostani Discordant']],
  seeds: {
    engineStarts: 'scd-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'scd-native-priority-v1',
  },
};
