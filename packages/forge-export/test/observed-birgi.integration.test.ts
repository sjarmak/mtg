/** Installed-Forge proof for Birgi's exact Harnfel discard-and-play route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Harnfel pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-birgi-harnfel-outcomes',
        cards: [
          { name: 'Mountain', count: 45 },
          { name: 'Birgi, God of Storytelling', count: 15 },
        ],
      },
    },
    {
      name: 'Harnfel observer',
      controller: 'local',
      deck: { name: 'z5q4-birgi-harnfel-observer', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-birgi-harnfel-exact-outcomes',
  maximumTurns: 30,
};

function hostId(oid: string): string {
  return oid.replace('forge-card-', '');
}

forgeIt(
  'casts Harnfel, discards one exact hand object, and limits both exiled cards to this turn',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let harnfelOid: string | null = null;
    let harnfelCastTurn = -1;
    let discardedOid: string | null = null;
    let activationTurn = -1;
    let exileOids: readonly string[] = [];
    let playedOid: string | null = null;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    let offeredThisTurn = false;
    let expiredNextTurn = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Birgi/Harnfel decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'cost-discard-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          const hand = new Set(session.view.seats[0].hand?.map((card) => card.oid));
          expect(candidates.length).toBeGreaterThan(0);
          expect(candidates.every((option) => hand.has(option.targets[0]!.oid))).toBe(true);
          await expect(session.submit('cost-discard-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected =
            candidates.find((option) => option.targets[0]?.name === 'Mountain') ?? candidates[0];
          if (selected === undefined) throw new Error('Forge offered no exact Harnfel discard candidate');
          discardedOid = selected.targets[0]!.oid;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0];
          const harnfel = local.battlefield.find(
            (card) => card.name === 'Harnfel, Horn of Bounty' || card.typeLine.includes('Artifact'),
          );
          harnfelOid ??= harnfel?.oid ?? null;
          if (discardedOid !== null && exileOids.length === 0) {
            const discarded = local.graveyard.some((card) => card.oid === discardedOid);
            if (discarded && local.exile.length === 2) exileOids = local.exile.map((card) => card.oid);
          }

          const exiledActions = exileOids.flatMap((oid) =>
            decision.options.filter((option) => option.id.startsWith(`ability-${hostId(oid)}-`)),
          );
          if (exileOids.length === 2 && session.view.turn.number === activationTurn) {
            offeredThisTurn ||= exiledActions.length > 0;
          }
          if (
            exileOids.length === 2 &&
            playedOid === null &&
            session.view.turn.number === activationTurn &&
            exiledActions[0] !== undefined
          ) {
            playedOid =
              exileOids.find((oid) => exiledActions[0]!.id.startsWith(`ability-${hostId(oid)}-`)) ?? null;
            move = exiledActions[0].id;
          }
          if (playedOid !== null && !local.exile.some((card) => card.oid === playedOid)) {
            const remaining = exileOids.find((oid) => oid !== playedOid);
            if (remaining !== undefined && session.view.turn.number > activationTurn) {
              expiredNextTurn =
                local.exile.some((card) => card.oid === remaining) &&
                decision.options.every((option) => !option.id.startsWith(`ability-${hostId(remaining)}-`));
            }
          }

          const mountains = local.battlefield.filter((card) => card.name === 'Mountain');
          const castBack = decision.options.find(
            (option) =>
              option.text.startsWith('Birgi, God of Storytelling:') &&
              option.text.endsWith('Harnfel, Horn of Bounty'),
          );
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith('Harnfel, Horn of Bounty:') && option.text.includes('Exile the top two'),
          );
          move ??=
            (expiredNextTurn
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (harnfelOid === null && mountains.length >= 5 ? castBack?.id : undefined) ??
            (harnfelOid !== null &&
            discardedOid === null &&
            session.view.turn.number > harnfelCastTurn &&
            session.view.turn.active === 0 &&
            session.view.turn.step === 'MAIN1'
              ? activate?.id
              : undefined) ??
            (exileOids.length === 0
              ? decision.options.find((option) => option.text === 'Play Mountain')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === castBack?.id) {
            const id: string | undefined = castBack?.id.match(/^ability-(\d+)-/u)?.[1];
            harnfelOid = id === undefined ? null : `forge-card-${id}`;
            harnfelCastTurn = session.view.turn.number;
          }
          if (move === activate?.id) activationTurn = session.view.turn.number;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Birgi/Harnfel move');
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
      expect(harnfelOid, evidence).toMatch(/^forge-card-/u);
      expect(discardedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === discardedOid),
        evidence,
      ).toBe(true);
      expect(exileOids, evidence).toHaveLength(2);
      expect(offeredThisTurn, evidence).toBe(true);
      expect(playedOid, evidence).toMatch(/^forge-card-/u);
      expect(expiredNextTurn, evidence).toBe(true);
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
