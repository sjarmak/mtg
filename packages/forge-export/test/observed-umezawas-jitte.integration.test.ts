/** Installed-Forge proof for Umezawa's Jitte's exact Equip, counters, and three modes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Jitte pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-umezawas-jitte-outcomes',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Student of Warfare', count: 15 },
          { name: "Umezawa's Jitte", count: 15 },
        ],
      },
    },
    {
      name: 'Jitte target pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-umezawas-jitte-target',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Wall of Omens', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-umezawas-jitte-exact-outcomes',
  maximumTurns: 30,
};

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find(
    (option) => option.text.startsWith(`${name}:`) && !option.text.includes('Equip'),
  )?.id;
}

forgeIt(
  'equips for {2}, gains two charge counters, and resolves each exact paid mode',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let pendingTarget: 'equip' | 'curse' | null = null;
    let equippedOid: string | null = null;
    let equipPaymentInFlight = false;
    let equipManaPayments = 0;
    let equipPaymentObserved = false;
    let attackerAddedOnTurn = -1;
    let chargePeak = 0;
    let selectedMode: 'curse' | 'life' | 'pump' | null = null;
    let modeIndex = 0;
    let chargeBeforeMode: number | null = null;
    let lifeBeforeMode: number | null = null;
    let curseOutcome = false;
    let lifeOutcome = false;
    let pumpOutcome = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Jitte decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          if (equipPaymentInFlight) equipManaPayments += 1;
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'mode-selection') {
          const wanted = ['-1/-1', 'gain 2 life', '+2/+2'][modeIndex];
          const mode = decision.options.find(
            (option) => wanted !== undefined && option.text.includes(wanted),
          );
          if (mode === undefined) throw new Error(`Forge offered no exact Jitte mode ${String(wanted)}`);
          expect(decision.options).toHaveLength(3);
          expect(decision.options.every((option) => option.id.startsWith('mode-selection-'))).toBe(true);
          await expect(session.submit('mode-selection-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          staleSnapshot = session;
          staleMove = mode.id;
          selectedMode = modeIndex === 0 ? 'curse' : modeIndex === 1 ? 'life' : 'pump';
          if (selectedMode === 'curse') pendingTarget = 'curse';
          move = mode.id;
        } else if (decision.kind === 'target-selection') {
          if (pendingTarget === 'equip') {
            const target = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Student of Warfare',
            );
            if (target === undefined) throw new Error('Forge offered no exact Jitte Equip target');
            equippedOid = target.targets[0]?.oid ?? null;
            equipPaymentInFlight = true;
            move = target.id;
          } else if (pendingTarget === 'curse') {
            const target = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Wall of Omens',
            );
            if (target === undefined) throw new Error('Forge offered no exact Jitte curse target');
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = target.id;
          } else {
            throw new Error(`unexpected Jitte target decision: ${decision.prompt}`);
          }
          pendingTarget = null;
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === equippedOid,
          );
          if (
            decision.seat === 0 &&
            modeIndex < 3 &&
            attackerAddedOnTurn !== session.view.turn.number &&
            add !== undefined
          ) {
            attackerAddedOnTurn = session.view.turn.number;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains');
          const opponentPlains = opponent.battlefield.filter((card) => card.name === 'Plains');
          const students = pilot.battlefield.filter((card) => card.name === 'Student of Warfare');
          const student = students.find((card) => card.oid === equippedOid);
          const jitte = pilot.battlefield.find((card) => card.name === "Umezawa's Jitte");
          const wall = opponent.battlefield.find((card) => card.name === 'Wall of Omens');
          const charge = jitte?.counters['CHARGE'] ?? 0;
          chargePeak = Math.max(chargePeak, charge);
          equipPaymentObserved ||= equippedOid !== null && equipManaPayments === 2;
          if (equipPaymentObserved) equipPaymentInFlight = false;

          if (selectedMode !== null && chargeBeforeMode !== null && charge === chargeBeforeMode - 1) {
            if (selectedMode === 'curse' && wall?.power === -1 && wall.toughness === 3) {
              curseOutcome = true;
              selectedMode = null;
              modeIndex = 1;
            } else if (
              selectedMode === 'life' &&
              lifeBeforeMode !== null &&
              pilot.life === lifeBeforeMode + 2
            ) {
              lifeOutcome = true;
              selectedMode = null;
              modeIndex = 2;
            } else if (selectedMode === 'pump' && student?.power === 3 && student.toughness === 3) {
              pumpOutcome = true;
              selectedMode = null;
              modeIndex = 3;
            }
          }

          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const untappedOpponentPlains = opponentPlains.filter((card) => !card.tapped).length;
          const equip = decision.options.find(
            (option) => option.text.startsWith("Umezawa's Jitte:") && option.text.includes('Equip'),
          );
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith("Umezawa's Jitte:") && option.text.includes('Remove a charge counter'),
          );
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (decision.seat === 1 && wall === undefined && untappedOpponentPlains >= 2
              ? castOption(session, 'Wall of Omens')
              : undefined) ??
            (decision.seat === 0 && students.length === 0 && untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 && students.length > 0 && jitte === undefined && untappedPlains >= 2
              ? castOption(session, "Umezawa's Jitte")
              : undefined) ??
            (decision.seat === 0 && jitte !== undefined && equippedOid === null && untappedPlains >= 2
              ? equip?.id
              : undefined) ??
            (decision.seat === 0 && selectedMode === null && modeIndex < 3 && charge > 0
              ? activate?.id
              : undefined) ??
            (modeIndex === 3
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === equip?.id) pendingTarget = 'equip';
          if (move === activate?.id) {
            chargeBeforeMode = charge;
            lifeBeforeMode = pilot.life;
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Jitte move');
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

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(equippedOid, evidence).toMatch(/^forge-card-/u);
      expect(equipPaymentObserved, evidence).toBe(true);
      expect(chargePeak, evidence).toBe(2);
      expect(curseOutcome, evidence).toBe(true);
      expect(lifeOutcome, evidence).toBe(true);
      expect(pumpOutcome, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
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
