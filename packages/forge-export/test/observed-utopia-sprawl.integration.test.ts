/** Installed-Forge proof for Utopia Sprawl's exact Forest Aura and chosen mana. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Utopia pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-utopia-sprawl-chosen-mana',
        cards: [
          { name: 'Forest', count: 24 },
          { name: 'Utopia Sprawl', count: 18 },
          { name: 'Wall of Blossoms', count: 18 },
        ],
      },
    },
    {
      name: 'Quiet opponent',
      controller: 'local',
      deck: { name: 'z5q4-utopia-sprawl-opponent', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-utopia-sprawl-chosen-mana-outcome',
  maximumTurns: 30,
};

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find((option) => option.text.startsWith(`${name}:`))?.id;
}

forgeIt(
  'targets an exact Forest, chooses green, and casts {1}{G} from that one enchanted land',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let pendingAuraTarget = false;
    let targetOid: string | null = null;
    let targetChosen = false;
    let colorChosen = false;
    let targetStaleRejected = false;
    let colorStaleRejected = false;
    let outcome = false;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Utopia Sprawl decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleMove: string | null = null;
        let staleKind: 'target' | 'color' | null = null;
        const staleSession = session;

        if (decision.kind === 'target-selection') {
          if (!pendingAuraTarget) throw new Error(`unexpected target decision: ${decision.prompt}`);
          const targets = decision.options.filter((option) => option.targets.length === 1);
          expect(targets.length).toBeGreaterThan(0);
          expect(targets.every((option) => option.targets[0]?.name === 'Forest')).toBe(true);
          const target = targets[0];
          if (target === undefined) throw new Error('Forge offered no exact Forest target');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          targetOid = target.targets[0]?.oid ?? null;
          targetChosen = true;
          move = target.id;
          staleMove = target.id;
          staleKind = 'target';
          pendingAuraTarget = false;
        } else if (decision.kind === 'color-choice') {
          expect(decision.prompt).toContain('Utopia Sprawl');
          expect(decision.options.map((option) => option.id)).toEqual([
            'color-choice-W',
            'color-choice-U',
            'color-choice-B',
            'color-choice-R',
            'color-choice-G',
          ]);
          expect(decision.options.every((option) => option.targets[0]?.name === 'Utopia Sprawl')).toBe(true);
          await expect(session.submit('color-choice-C')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          move = 'color-choice-G';
          staleMove = move;
          staleKind = 'color';
          colorChosen = true;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0];
          const forests = local.battlefield.filter((card) => card.name === 'Forest');
          const aura = local.battlefield.find((card) => card.name === 'Utopia Sprawl');
          const wall = local.battlefield.find((card) => card.name === 'Wall of Blossoms');
          outcome ||=
            targetChosen &&
            colorChosen &&
            targetOid !== null &&
            forests.length === 1 &&
            forests[0]?.oid === targetOid &&
            forests[0]?.tapped === true &&
            aura !== undefined &&
            wall !== undefined;
          const castUtopia =
            decision.seat === 0 && aura === undefined && forests.some((card) => !card.tapped)
              ? castOption(session, 'Utopia Sprawl')
              : undefined;
          const castWall =
            decision.seat === 0 &&
            aura !== undefined &&
            wall === undefined &&
            forests.length === 1 &&
            forests[0]?.tapped === false
              ? castOption(session, 'Wall of Blossoms')
              : undefined;
          move =
            (decision.seat === 0 && forests.length === 0
              ? decision.options.find((option) => option.text === 'Play Forest')?.id
              : undefined) ??
            (decision.seat === 1
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : undefined) ??
            castUtopia ??
            castWall ??
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === castUtopia) pendingAuraTarget = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Utopia Sprawl move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          if (staleKind === 'target') targetStaleRejected = true;
          if (staleKind === 'color') colorStaleRejected = true;
        }
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(targetOid, evidence).toMatch(/^forge-card-/u);
      expect(targetStaleRejected, evidence).toBe(true);
      expect(colorStaleRejected, evidence).toBe(true);
      expect(outcome, evidence).toBe(true);
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
