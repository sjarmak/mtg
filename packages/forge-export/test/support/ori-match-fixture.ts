/** Magic Origins whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const ORI_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'ori',
  title: 'ORI',
  land: 'Plains',
  creature: 'Kytheon, Hero of Akros',
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'ori-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'ori-native-priority-v1',
  },
};
