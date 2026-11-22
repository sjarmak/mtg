import type { PrintedMatchFixture } from './printed-match-probes';

export const LRW_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'lrw',
  title: 'Lorwyn',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'lrw-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'lrw-native-priority-v1',
  },
};
