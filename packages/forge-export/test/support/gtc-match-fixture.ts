/** Gatecrash whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const GTC_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'gtc',
  title: 'GTC',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'gtc-local-pregame-v2',
    localToss: '1514',
    nativePriority: 'gtc-native-priority-v1',
  },
};
