/** Installed-Forge proof for Sword of Fire and Ice's exact attachment and combat trigger. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(color: 'red' | 'blue'): SessionSpec {
  const land = color === 'red' ? 'Mountain' : 'Island';
  const blocker = color === 'red' ? 'Monastery Swiftspear' : 'Pteramander';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Sword pilot',
        controller: 'local',
        deck: {
          name: `z5q4-sword-${color}-protection`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Student of Warfare', count: 15 },
            { name: 'Sword of Fire and Ice', count: 15 },
          ],
        },
      },
      {
        name: `${color} blocker pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-sword-${color}-blocker`,
          cards: [
            { name: land, count: 30 },
            { name: blocker, count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-sword-of-fire-and-ice-${color}-outcomes`,
    maximumTurns: 30,
  };
}

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find(
    (option) => option.text.startsWith(`${name}:`) && !option.text.includes('Equip'),
  )?.id;
}

forgeIt.each([
  ['red', 'Mountain', 'Monastery Swiftspear'],
  ['blue', 'Island', 'Pteramander'],
] as const)(
  'equips for {2}, preserves %s protection legality, deals two, and draws one',
  async (color, land, blockerName) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let pendingTarget: 'equip' | 'damage' | null = null;
    let equippedOid: string | null = null;
    let attackerAdded = false;
    let protectedAttackInFlight = false;
    let protectionObserved = false;
    let equipOutcome = false;
    let equipPaymentObserved = false;
    let opponentLifeBeforeAttack: number | null = null;
    let pilotLibraryBeforeTrigger: number | null = null;
    let triggerOutcome = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    try {
      expect(await backend.supports(table(color))).toEqual([]);
      const opened = await backend.open(table(color));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Sword decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          if (pendingTarget === null && attackerAdded) pendingTarget = 'damage';
          if (pendingTarget === 'equip') {
            const target = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Student of Warfare',
            );
            if (target === undefined) throw new Error('Forge offered no exact Sword Equip target');
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            equippedOid = target.targets[0]?.oid ?? null;
            move = target.id;
          } else if (pendingTarget === 'damage') {
            expect(decision.options.some((option) => option.id === 'target-player-1')).toBe(true);
            pilotLibraryBeforeTrigger = session.view.seats[0].librarySize;
            staleSnapshot = session;
            staleMove = 'target-player-1';
            move = 'target-player-1';
          } else {
            throw new Error(`unexpected target decision: ${decision.prompt}`);
          }
          pendingTarget = null;
        } else if (decision.kind === 'combat-attackers') {
          const equipped = session.view.seats[0].battlefield.find((card) => card.oid === equippedOid);
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === equippedOid,
          );
          if (
            !attackerAdded &&
            equipOutcome &&
            blocker !== undefined &&
            !blocker.tapped &&
            add !== undefined
          ) {
            expect(equipped).toMatchObject({ power: 3, toughness: 3 });
            opponentLifeBeforeAttack = session.view.seats[1].life;
            attackerAdded = true;
            protectedAttackInFlight = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          if (attackerAdded && blocker !== undefined) {
            expect(blocker.tapped).toBe(false);
            expect(
              decision.options.some(
                (option) =>
                  option.id.startsWith('combat-block-add-') && option.targets[0]?.oid === blocker.oid,
              ),
            ).toBe(false);
            protectionObserved = true;
          }
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          const students = pilot.battlefield.filter((card) => card.name === 'Student of Warfare');
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const sword = pilot.battlefield.find((card) => card.name === 'Sword of Fire and Ice');
          const blocker = opponent.battlefield.find((card) => card.name === blockerName);
          if (protectedAttackInFlight && session.view.turn.step === 'COMBAT_END') {
            // Forge omits blocker selection altogether when no legal blocker exists.
            protectionObserved = true;
          }
          const untappedOpponentLands = opponent.battlefield.filter(
            (card) => card.name === land && !card.tapped,
          ).length;
          const equipped = students.find((card) => card.oid === equippedOid);
          equipOutcome ||= equipped?.power === 3 && equipped.toughness === 3;
          equipPaymentObserved ||= equipOutcome && plains.filter((card) => card.tapped).length === 2;
          triggerOutcome ||=
            protectionObserved &&
            opponentLifeBeforeAttack !== null &&
            pilotLibraryBeforeTrigger !== null &&
            opponent.life === opponentLifeBeforeAttack - 5 &&
            pilot.librarySize === pilotLibraryBeforeTrigger - 1;

          const equip = decision.options.find(
            (option) => option.text.startsWith('Sword of Fire and Ice:') && option.text.includes('Equip'),
          );
          move =
            decision.options.find((option) => option.text === `Play ${decision.seat === 0 ? 'Plains' : land}`)
              ?.id ??
            (decision.seat === 1 && blocker === undefined && untappedOpponentLands >= 1
              ? castOption(session, blockerName)
              : undefined) ??
            (decision.seat === 0 && students.length === 0 && untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 && students.length > 0 && sword === undefined && untappedPlains >= 3
              ? castOption(session, 'Sword of Fire and Ice')
              : undefined) ??
            (decision.seat === 0 && sword !== undefined && equippedOid === null && untappedPlains >= 2
              ? equip?.id
              : undefined) ??
            (triggerOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === equip?.id) pendingTarget = 'equip';
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Sword move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(typeof equippedOid, evidence).toBe('string');
      expect(String(equippedOid), evidence).toMatch(/^forge-card-/u);
      expect(equipOutcome, evidence).toBe(true);
      expect(equipPaymentObserved, evidence).toBe(true);
      expect(protectionObserved, evidence).toBe(true);
      expect(triggerOutcome, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-360).join('\n')}`, { cause });
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
