/** Installed-Forge proof for Splinter Twin's exact creature Aura and copied token. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Twin pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-splinter-twin-copy',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Island', count: 12 },
          { name: 'Pteramander', count: 12 },
          { name: 'Splinter Twin', count: 12 },
        ],
      },
    },
    {
      name: 'Quiet opponent',
      controller: 'local',
      deck: { name: 'z5q4-splinter-twin-opponent', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-splinter-twin-copy-outcome',
  maximumTurns: 40,
};

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find((option) => option.text.startsWith(`${name}:`))?.id;
}

forgeIt(
  'targets a creature, creates a hasty copy, attacks with it, and loses it at end step',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let pendingAuraTarget = false;
    let originalOid: string | null = null;
    let tokenOid: string | null = null;
    let targetStaleRejected = false;
    let activationStaleRejected = false;
    let activationSubmitted = false;
    let hastyAttackOffered = false;
    let tokenRemoved = false;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Splinter Twin decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        const pilot = session.view.seats[0];
        const pteramanders = pilot.battlefield.filter((card) => card.name === 'Pteramander');
        if (activationSubmitted && pteramanders.length === 2 && originalOid !== null) {
          tokenOid ??= pteramanders.find((card) => card.oid !== originalOid)?.oid ?? null;
        }
        if (tokenOid !== null && !pteramanders.some((card) => card.oid === tokenOid)) tokenRemoved = true;

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleMove: string | null = null;
        const staleSession = session;

        if (decision.kind === 'target-selection') {
          if (!pendingAuraTarget) throw new Error(`unexpected target decision: ${decision.prompt}`);
          const target = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.oid === originalOid,
          );
          if (target === undefined) throw new Error('Forge offered no exact original creature target');
          expect(
            decision.options.every(
              (option) => option.id === 'target-cancel' || option.targets[0]?.name === 'Pteramander',
            ),
          ).toBe(true);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          move = target.id;
          staleMove = target.id;
          pendingAuraTarget = false;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const addToken = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              tokenOid !== null &&
              option.targets[0]?.oid === tokenOid,
          );
          if (addToken !== undefined && !hastyAttackOffered) {
            hastyAttackOffered = true;
            move = addToken.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const mountains = pilot.battlefield.filter((card) => card.name === 'Mountain');
          const islands = pilot.battlefield.filter((card) => card.name === 'Island');
          const twin = pilot.battlefield.find((card) => card.name === 'Splinter Twin');
          const untappedLands = [...mountains, ...islands].filter((card) => !card.tapped).length;
          const activation = decision.options.find(
            (option) =>
              originalOid !== null &&
              option.text.startsWith('Pteramander:') &&
              option.text.includes("Create a token that's a copy of this creature"),
          );
          const castTwin = castOption(session, 'Splinter Twin');
          move =
            decision.options.find(
              (option) =>
                option.text ===
                `Play ${decision.seat === 0 ? (islands.length === 0 ? 'Island' : 'Mountain') : 'Plains'}`,
            )?.id ??
            (decision.seat === 0 && pteramanders.length === 0 && islands.length >= 1 && untappedLands >= 1
              ? castOption(session, 'Pteramander')
              : undefined) ??
            (decision.seat === 0 &&
            pteramanders.length === 1 &&
            twin === undefined &&
            mountains.length >= 2 &&
            untappedLands >= 4
              ? castTwin
              : undefined) ??
            (decision.seat === 0 && twin !== undefined && !activationSubmitted
              ? activation?.id
              : undefined) ??
            (tokenRemoved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castTwin !== undefined && move === castTwin) pendingAuraTarget = true;
          if (activation !== undefined && move === activation.id) {
            activationSubmitted = true;
            staleMove = move;
          }
          originalOid ??= pteramanders[0]?.oid ?? null;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Splinter Twin move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          if (staleMove.startsWith('target-')) targetStaleRejected = true;
          else activationStaleRejected = true;
        }
      }

      const evidence = `${trace.slice(-500).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(originalOid, evidence).toMatch(/^forge-card-/u);
      expect(tokenOid, evidence).toMatch(/^forge-card-/u);
      expect(tokenOid, evidence).not.toBe(originalOid);
      expect(targetStaleRejected, evidence).toBe(true);
      expect(activationStaleRejected, evidence).toBe(true);
      expect(hastyAttackOffered, evidence).toBe(true);
      expect(tokenRemoved, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-500).join('\n')}`, { cause });
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
