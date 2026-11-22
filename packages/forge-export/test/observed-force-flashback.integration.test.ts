/** Installed-Forge regression for Snapcaster Mage granting reviewed counterspells flashback. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const reviewedCounterspells = ['Daze', 'Force of Negation', 'Force of Will'] as const;

function tableFor(counterspell: (typeof reviewedCounterspells)[number]): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Snapcaster pilot',
        controller: 'local',
        deck: {
          name: 'snapcaster-counterspell',
          cards: [
            { name: 'Island', count: 20 },
            { name: 'Snapcaster Mage', count: 20 },
            { name: counterspell, count: 20 },
          ],
        },
      },
      {
        name: 'Opponent',
        controller: 'local',
        deck: { name: 'mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `${counterspell.toLowerCase().replaceAll(' ', '-')}-snapcaster-flashback`,
    maximumTurns: 2,
  };
}

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

forgeIt.each(reviewedCounterspells)(
  'keeps the Snapcaster Mage flashback copy separate from the %s alternative cost',
  async (counterspell) => {
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: ['Snapcaster Mage'],
            library: Array<string>(20).fill('Island'),
            battlefield: ['Island', 'Island'],
            graveyard: [counterspell],
          },
          {
            life: 20,
            hand: [],
            library: Array<string>(20).fill('Mountain'),
            battlefield: [],
            graveyard: [],
          },
        ],
      },
      { timeoutMs: 180_000 },
    );
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let targetedCounterspell = false;
    try {
      const opened = await backend.open(tableFor(counterspell));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; submitted < 40; submitted += 1) {
        if (session.status === 'finished') {
          expect(targetedCounterspell).toBe(true);
          return;
        }
        const reviewedCard = session.view.seats[0].graveyard.find((card) => card.name === counterspell);
        const snapcaster = session.view.seats[0].hand?.find((card) => card.name === 'Snapcaster Mage');
        if (targetedCounterspell && session.decision?.kind === 'priority') {
          const counterspellMoves = session.decision.options.filter((option) =>
            option.text.startsWith(`${counterspell}:`),
          );
          expect(counterspellMoves.every((option) => !option.text.includes('(alternative cost)'))).toBe(true);
        }
        let move = session.play?.automatic?.move;
        if (move === undefined && session.decision?.kind === 'priority') {
          move =
            session.play?.objectActions.find(
              (action) => action.category === 'cast' && action.oid === snapcaster?.oid,
            )?.move ??
            session.play?.passPriority ??
            undefined;
        }
        if (
          move === undefined &&
          session.decision?.kind === 'target-selection' &&
          reviewedCard !== undefined
        ) {
          move = session.decision.options.find((option) => option.targets[0]?.oid === reviewedCard.oid)?.id;
          targetedCounterspell = move !== undefined;
        }
        if (move === undefined) {
          throw new Error(`Unexpected Forge decision: ${session.decision?.kind ?? 'none'}`);
        }
        session = await submit(session, move);
      }
      throw new Error(`Forge did not expose the granted ${counterspell} flashback spell`);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  180_000,
);
