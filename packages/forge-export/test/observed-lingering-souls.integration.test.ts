/** Installed-Forge proof for Lingering Souls' exact token-and-Flashback composition. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Souls pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-lingering-souls-exact-composition',
        cards: [
          { name: 'Plains', count: 25 },
          { name: 'Swamp', count: 25 },
          { name: 'Lingering Souls', count: 10 },
        ],
      },
    },
    {
      name: 'Quiet pilot',
      controller: 'engine',
      deck: { name: 'z5q4-lingering-souls-quiet-pilot', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-lingering-souls-flashback-exact-outcomes',
  maximumTurns: 20,
};

forgeIt(
  'creates two exact Spirits twice and moves the same source from hand through graveyard to exile',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sourceOid: string | undefined;
    let ordinaryCast = false;
    let flashbackCast = false;
    let ordinaryResolved = false;
    let flashbackResolved = false;
    let inventedRejected = false;
    let staleRejected = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    const ordinaryPayment: string[] = [];
    const flashbackPayment: string[] = [];
    const trace: string[] = [];
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Lingering Souls decision');
        const seat = session.view.seats[0];
        const spirits = seat.battlefield.filter((card) => card.name === 'Spirit Token');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        if (ordinaryCast && !ordinaryResolved && sourceOid !== undefined) {
          ordinaryResolved =
            spirits.length === 2 &&
            seat.graveyard.some((card) => card.oid === sourceOid) &&
            session.view.stack.every((card) => card.oid !== sourceOid);
        }
        if (flashbackCast && sourceOid !== undefined) {
          flashbackResolved =
            spirits.length === 4 &&
            seat.exile.some((card) => card.oid === sourceOid) &&
            !seat.graveyard.some((card) => card.oid === sourceOid) &&
            session.view.stack.every((card) => card.oid !== sourceOid);
        }
        if (spirits.length > 0) {
          expect(new Set(spirits.map((card) => card.oid)).size).toBe(spirits.length);
          expect(spirits.every((card) => /Creature.*Spirit/u.test(card.typeLine))).toBe(true);
          expect(spirits.every((card) => card.power === 1 && card.toughness === 1)).toBe(true);
        }

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          const selected = decision.options.find((option) => option.id !== 'mana-payment-cancel');
          move = selected?.id;
          const sourceName = selected?.targets[0]?.name;
          if (sourceName !== undefined) {
            (flashbackCast ? flashbackPayment : ordinaryPayment).push(sourceName);
          }
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const soulsAction = decision.options.find((option) => option.text.startsWith('Lingering Souls:'));
          const untappedLands = seat.battlefield.filter(
            (card) => (card.name === 'Plains' || card.name === 'Swamp') && !card.tapped,
          ).length;
          if (soulsAction !== undefined && !ordinaryCast && untappedLands >= 3) {
            sourceOid = seat.hand?.find((card) => card.name === 'Lingering Souls')?.oid;
            expect(sourceOid).toMatch(/^forge-card-/u);
            await expect(session.submit('ability-invented-lingering-souls')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
            staleSnapshot = session;
            staleMove = soulsAction.id;
            ordinaryCast = true;
            move = soulsAction.id;
          } else if (soulsAction !== undefined && ordinaryResolved && !flashbackCast && untappedLands >= 2) {
            expect(seat.graveyard.some((card) => card.oid === sourceOid)).toBe(true);
            flashbackCast = true;
            move = soulsAction.id;
          } else {
            const plains = decision.options.find((option) => option.text === 'Play Plains');
            const swamp = decision.options.find((option) => option.text === 'Play Swamp');
            const battlefieldNames = new Set(seat.battlefield.map((card) => card.name));
            move =
              (flashbackResolved
                ? decision.options.find((option) => option.text === 'Concede')?.id
                : undefined) ??
              (!battlefieldNames.has('Plains') ? plains?.id : undefined) ??
              (!battlefieldNames.has('Swamp') ? swamp?.id : undefined) ??
              plains?.id ??
              swamp?.id ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Lingering Souls move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null && !staleRejected) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          staleSnapshot = null;
          staleMove = null;
        }
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(ordinaryResolved, evidence).toBe(true);
      expect(ordinaryPayment, evidence).toHaveLength(3);
      expect(ordinaryPayment, evidence).toContain('Plains');
      expect(flashbackResolved, evidence).toBe(true);
      expect(flashbackPayment, evidence).toHaveLength(2);
      expect(flashbackPayment, evidence).toContain('Swamp');
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  300_000,
);
