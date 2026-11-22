/** Installed-Forge proof for Maul of the Skyclaves' exact attachment lifecycle. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Maul pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-maul-exact-attach-and-equip',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Student of Warfare', count: 15 },
          { name: 'Maul of the Skyclaves', count: 15 },
        ],
      },
    },
    {
      name: 'Quiet pilot',
      controller: 'local',
      deck: { name: 'z5q4-maul-quiet-pilot', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-maul-of-the-skyclaves-exact-outcomes',
  maximumTurns: 24,
};

function isCast(text: string, name: string): boolean {
  return text.startsWith(`${name}: ${name} - `);
}

forgeIt(
  'observes exact ETB attachment, +2/+2, and later {2}{W}{W} re-equipment',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let pending: 'etb' | 'equip' | null = null;
    let firstTarget: string | null = null;
    let secondTarget: string | null = null;
    let entryOutcome = false;
    let equipOutcome = false;
    let equipPaymentObserved = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Maul decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          if (pending === null) throw new Error(`unexpected target decision: ${decision.prompt}`);
          const students = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Student of Warfare',
          );
          expect(students).toHaveLength(2);
          expect(new Set(students.map((option) => option.targets[0]!.oid)).size).toBe(2);
          const selected =
            pending === 'etb'
              ? students[0]
              : students.find((option) => option.targets[0]?.oid !== firstTarget);
          if (selected === undefined) throw new Error('Forge offered no exact Maul target');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (pending === 'etb') firstTarget = selected.targets[0]?.oid ?? null;
          else secondTarget = selected.targets[0]?.oid ?? null;
          staleSnapshot = session;
          staleMove = selected.id;
          pending = null;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const students = battlefield.filter((card) => card.name === 'Student of Warfare');
          const plains = battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const first = students.find((card) => card.oid === firstTarget);
          const second = students.find((card) => card.oid === secondTarget);
          entryOutcome ||=
            firstTarget !== null &&
            secondTarget === null &&
            first?.power === 3 &&
            first.toughness === 3 &&
            students.some((card) => card.oid !== firstTarget && card.power === 1 && card.toughness === 1);
          equipOutcome ||=
            secondTarget !== null &&
            first?.power === 1 &&
            first.toughness === 1 &&
            second?.power === 3 &&
            second.toughness === 3;
          equipPaymentObserved ||= equipOutcome && plains.filter((card) => card.tapped).length === 4;
          const equip = decision.options.find(
            (option) => option.text.startsWith('Maul of the Skyclaves:') && option.text.includes('Equip'),
          );
          const castStudent = decision.options.find((option) => isCast(option.text, 'Student of Warfare'));
          const castMaul = decision.options.find(
            (option) => option.text === 'Maul of the Skyclaves: Maul of the Skyclaves',
          );
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (students.length < 2 && untappedPlains >= 1 ? castStudent?.id : undefined) ??
            (students.length >= 2 && firstTarget === null && untappedPlains >= 3
              ? castMaul?.id
              : undefined) ??
            (entryOutcome && secondTarget === null && untappedPlains >= 4 ? equip?.id : undefined) ??
            (equipOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === castMaul?.id) pending = 'etb';
          if (move === equip?.id) pending = 'equip';
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Maul move');
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

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(firstTarget, evidence).toMatch(/^forge-card-/u);
      expect(secondTarget, evidence).toMatch(/^forge-card-/u);
      expect(entryOutcome, evidence).toBe(true);
      expect(equipOutcome, evidence).toBe(true);
      expect(equipPaymentObserved, evidence).toBe(true);
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
  240_000,
);
