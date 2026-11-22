/** Installed-Forge proof for proactive mana actions on the shared play contract. */
import { describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'priority-mana-human',
        cards: [
          { name: 'Tropical Island', count: 30 },
          { name: 'Birds of Paradise', count: 30 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'priority-mana-ai', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: '1514',
  maximumTurns: 2,
};

const SPENT_FOREST_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'priority-mana-spent-forest',
        cards: [
          { name: 'Forest', count: 20 },
          { name: 'Birds of Paradise', count: 20 },
          { name: 'Sakura-Tribe Elder', count: 20 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'priority-mana-spent-forest-ai', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'priority-mana-spent-forest-sick-birds',
  maximumTurns: 2,
};

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const result = await session.submit(move);
  if (!result.ok) throw new Error(result.error.message);
  return result.session;
}

describe('installed Forge priority mana actions', () => {
  forgeIt(
    'exposes both dual-land outputs, activates one, and takes it back',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires FORGE_HOME').not.toBeNull();
      if (backend === null) return;
      let session: ObservedSession | null = null;
      try {
        const opened = await backend.open(TABLE);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;

        const playFirst = session.decision?.options.find((option) => option.id === 'pregame-start-seat-0');
        expect(playFirst).toBeDefined();
        session = await submit(session, playFirst!.id);
        const keep = session.decision?.options.find((option) => option.text === 'Keep this hand');
        expect(keep).toBeDefined();
        session = await submit(session, keep!.id);

        const tropical = session.view.seats[0].hand?.find((card) => card.name === 'Tropical Island');
        expect(tropical).toBeDefined();
        let landPlay = session.play?.objectActions.find(
          (action) => action.oid === tropical!.oid && action.category === 'play',
        );
        for (let passes = 0; landPlay === undefined && passes < 8; passes += 1) {
          const pass = session.play?.passPriority;
          expect(pass).not.toBeNull();
          session = await submit(session, pass!);
          landPlay = session.play?.objectActions.find(
            (action) => action.oid === tropical!.oid && action.category === 'play',
          );
        }
        expect(landPlay).toBeDefined();
        session = await submit(session, landPlay!.move);

        const mana = session.play?.objectActions.filter(
          (action) => action.oid === tropical!.oid && action.category === 'mana',
        );
        expect(mana?.map((action) => action.manaOutput).sort()).toEqual(['G', 'U']);
        const green = mana?.find((action) => action.manaOutput === 'G');
        expect(green).toBeDefined();
        session = await submit(session, green!.move);

        expect(session.view.seats[0].battlefield.find((card) => card.oid === tropical!.oid)?.tapped).toBe(
          true,
        );
        expect(
          session.play?.objectActions.some(
            (action) => action.oid === tropical!.oid && action.category === 'mana',
          ),
        ).toBe(false);
        expect(session.play?.manaPools?.[0]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 });
        expect(session.play?.undo).toBe('undo-mana');
        session = await submit(session, session.play!.undo!);

        expect(session.view.seats[0].battlefield.find((card) => card.oid === tropical!.oid)?.tapped).toBe(
          false,
        );
        expect(session.play?.manaPools?.[0]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
        expect(
          session.play?.objectActions
            .filter((action) => action.oid === tropical!.oid && action.category === 'mana')
            .map((action) => action.manaOutput)
            .sort(),
        ).toEqual(['G', 'U']);
        expect(session.play?.undo).toBeUndefined();
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    180_000,
  );

  forgeIt(
    'does not offer a two-mana spell after the only land casts a summoning-sick mana creature',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires FORGE_HOME').not.toBeNull();
      if (backend === null) return;
      let session: ObservedSession | null = null;
      try {
        const opened = await backend.open(SPENT_FOREST_TABLE);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;

        const playFirst = session.decision?.options.find((option) => option.id === 'pregame-start-seat-0');
        expect(playFirst).toBeDefined();
        session = await submit(session, playFirst!.id);
        const keep = session.decision?.options.find((option) => option.text === 'Keep this hand');
        expect(keep).toBeDefined();
        session = await submit(session, keep!.id);

        const hand = session.view.seats[0].hand ?? [];
        const forest = hand.find((card) => card.name === 'Forest');
        const birds = hand.find((card) => card.name === 'Birds of Paradise');
        const elder = hand.find((card) => card.name === 'Sakura-Tribe Elder');
        expect({ forest: forest?.name, birds: birds?.name, elder: elder?.name }).toEqual({
          forest: 'Forest',
          birds: 'Birds of Paradise',
          elder: 'Sakura-Tribe Elder',
        });

        let playForest = session.play?.objectActions.find(
          (action) => action.oid === forest!.oid && action.category === 'play',
        );
        for (let passes = 0; playForest === undefined && passes < 8; passes += 1) {
          expect(session.play?.passPriority).not.toBeNull();
          session = await submit(session, session.play!.passPriority!);
          playForest = session.play?.objectActions.find(
            (action) => action.oid === forest!.oid && action.category === 'play',
          );
        }
        expect(playForest).toBeDefined();
        session = await submit(session, playForest!.move);

        const castBirds = session.play?.objectActions.find(
          (action) => action.oid === birds!.oid && action.category === 'cast',
        );
        expect(castBirds).toBeDefined();
        session = await submit(session, castBirds!.move);

        for (let moves = 0; moves < 12; moves += 1) {
          const battlefieldBirds = session.view.seats[0].battlefield.find(
            (card) => card.name === 'Birds of Paradise',
          );
          if (battlefieldBirds !== undefined && session.view.priority === 0) break;
          const automatic = session.play?.automatic?.move;
          const pass = session.play?.passPriority;
          const move = automatic ?? pass;
          expect(move, 'Forge exposed neither exact payment nor priority while Birds resolved').toBeDefined();
          session = await submit(session, move!);
        }

        const battlefieldForest = session.view.seats[0].battlefield.find((card) => card.oid === forest!.oid);
        const battlefieldBirds = session.view.seats[0].battlefield.find(
          (card) => card.name === 'Birds of Paradise',
        );
        expect(battlefieldForest?.tapped).toBe(true);
        expect(battlefieldBirds).toBeDefined();
        expect(
          session.play?.objectActions.some(
            (action) => action.oid === battlefieldBirds!.oid && action.category === 'mana',
          ),
        ).toBe(false);
        expect(
          session.play?.objectActions.some(
            (action) => action.oid === elder!.oid && action.category === 'cast',
          ),
        ).toBe(false);
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    180_000,
  );
});
