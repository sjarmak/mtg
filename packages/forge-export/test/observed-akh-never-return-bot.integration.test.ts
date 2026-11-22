/** Native Forge chooses both halves; assertions use only public zone transitions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Observer',
      controller: 'local',
      deck: {
        name: 'creatures',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Defiant Khenra', count: 30 },
        ],
      },
    },
    {
      name: 'Native Never pilot',
      controller: 'engine',
      deck: {
        name: 'removal',
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Never // Return', count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-hou-never-return-native-v1',
  maximumTurns: 32,
};

forgeIt(
  'Forge destroys a threat with Never and uses Return to exile a graveyard card and make a Zombie',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let priorGrave: readonly string[] = [];
    let never: { oid: string; creatures: readonly string[] } | undefined;
    let returned:
      { oid: string; graves: readonly string[]; exile: readonly string[]; zombies: number } | undefined;
    let destroyed = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const local = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const graves = session.view.seats.flatMap((seat) => seat.graveyard);
        const exiles = session.view.seats.flatMap((seat) => seat.exile);
        const zombies = bot.battlefield.filter((card) => card.typeLine.includes('Zombie'));
        const spell = session.view.stack.find(
          (card) => card.name.includes('Never') || card.name.includes('Return'),
        );
        if (spell !== undefined && priorGrave.includes(spell.oid) && returned === undefined) {
          returned = {
            oid: spell.oid,
            graves: graves.map((card) => card.oid),
            exile: exiles.map((card) => card.oid),
            zombies: zombies.length,
          };
        } else if (spell !== undefined && never === undefined && !priorGrave.includes(spell.oid)) {
          never = {
            oid: spell.oid,
            creatures: local.battlefield
              .filter((card) => card.name === 'Defiant Khenra')
              .map((card) => card.oid),
          };
        }
        const removal = never;
        if (removal !== undefined && !destroyed && bot.graveyard.some((card) => card.oid === removal.oid)) {
          const dead = local.graveyard.filter((card) => removal.creatures.includes(card.oid));
          expect(dead).toHaveLength(1);
          for (const oid of removal.creatures.filter((oid) => oid !== dead[0]?.oid)) {
            expect(local.battlefield.some((card) => card.oid === oid)).toBe(true);
          }
          expect(bot.exile.some((card) => card.oid === removal.oid)).toBe(false);
          destroyed = true;
        }
        const aftermath = returned;
        if (aftermath !== undefined && bot.exile.some((card) => card.oid === aftermath.oid)) {
          const chosen = exiles.filter(
            (card) => card.oid !== aftermath.oid && !aftermath.exile.includes(card.oid),
          );
          expect(chosen).toHaveLength(1);
          expect(aftermath.graves).toContain(chosen[0]?.oid);
          expect(graves.some((card) => card.oid === chosen[0]?.oid || card.oid === aftermath.oid)).toBe(
            false,
          );
          for (const oid of aftermath.graves.filter((oid) => oid !== chosen[0]?.oid)) {
            expect(graves.some((card) => card.oid === oid)).toBe(true);
          }
          expect(zombies).toHaveLength(aftermath.zombies + 1);
          for (const zombie of zombies) expect(zombie).toMatchObject({ power: 2, toughness: 2 });
          resolved = true;
          break;
        }
        priorGrave = bot.graveyard.map((card) => card.oid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        );
        let move =
          decision.kind === 'priority'
            ? (decision.options.find((option) => option.text === 'Play Mountain')?.id ??
              decision.options.find((option) => option.text.startsWith('Defiant Khenra:'))?.id)
            : decision.kind === 'mana-payment'
              ? decision.options.find((option) => option.id.startsWith('mana-source-'))?.id
              : undefined;
        // Keep combat quiet so zone changes cannot be misattributed to combat deaths.
        move ??=
          decision.kind === 'discard-selection'
            ? (decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
              decision.options[0]?.id)
            : decision.options.find(
                (option) =>
                  ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
                  ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
              )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(destroyed, trace.slice(-16).join('\n')).toBe(true);
      expect(resolved, trace.slice(-16).join('\n')).toBe(true);
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
